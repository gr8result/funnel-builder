// /pages/api/email/autoresponders/process-queue.js
// FULL FILE — processes email_autoresponder_queue rows and sends via SendGrid
//
// ✅ Uses SUPABASE_SERVICE_ROLE_KEY (server-side)
// ✅ Sends queued rows whose scheduled_at <= now()
// ✅ Updates status: queued -> sending -> sent/failed
// ✅ Stores provider_message_id + last_error + attempts
// ✅ Adds SendGrid custom_args so your /api/email/sendgrid-events.js can attribute opens/clicks
//
// AUTH:
//  - Authorization: Bearer <CRON_SECRET>   OR
//  - header: x-cron-key: <CRON_SECRET>     OR
//  - query:  ?key=<CRON_SECRET>
//
// ENV:
//  - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  - SUPABASE_SERVICE_ROLE_KEY
//  - SENDGRID_API_KEY
//  - EMAIL_ASSETS_BUCKET (optional; default "email-user-assets")

import { createClient } from "@supabase/supabase-js";
import sgMail from "@sendgrid/mail";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY_ROLE ||
  process.env.SUPABASE_SERVICE;

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const BUCKET = (process.env.EMAIL_ASSETS_BUCKET || "email-user-assets").trim();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

function isAuthed(req) {
  const q = String(req.query?.key || "").trim();
  const h = String(req.headers["x-cron-key"] || "").trim();
  const a = String(req.headers.authorization || "").trim();
  const bearer = a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
  const key = q || h || bearer;
  return !!CRON_SECRET && key === CRON_SECRET;
}

function s(v) {
  return String(v ?? "").trim();
}

async function readHtmlFromStorage(template_path) {
  const path = s(template_path);
  if (!path) throw new Error("Missing template_path");

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error) throw error;
  const buf = await data.arrayBuffer();
  const html = Buffer.from(buf).toString("utf-8");
  if (!html) throw new Error("Template download returned empty HTML");
  return html;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(200).json({ ok: false, error: "POST or GET only" });
  }

  if (!isAuthed(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized (cron secret)" });
  }

  try {
    const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);

    if (!process.env.SENDGRID_API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing SENDGRID_API_KEY" });
    }
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    // 1) Load queued items ready to send
    const nowIso = new Date().toISOString();
    const { data: rows, error: qErr } = await supabaseAdmin
      .from("email_autoresponder_queue")
      .select(
        "id,user_id,autoresponder_id,list_id,lead_id,to_email,to_name,subject,template_path,scheduled_at,status,attempts"
      )
      .eq("status", "queued")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(limit);

    if (qErr) throw qErr;

    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
      return res.status(200).json({ ok: true, processed: 0, note: "No queued rows ready to send." });
    }

    let sent = 0;
    let failed = 0;

    for (const r of items) {
      const id = r.id;

      // 2) Claim row (avoid duplicate sends)
      const { data: claimed, error: cErr } = await supabaseAdmin
        .from("email_autoresponder_queue")
        .update({ status: "sending" })
        .eq("id", id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();

      if (cErr) {
        failed += 1;
        continue;
      }
      if (!claimed?.id) {
        // someone else claimed it
        continue;
      }

      try {
        // 3) Load sender/from data from email_automations
        const { data: ar, error: arErr } = await supabaseAdmin
          .from("email_automations")
          .select("id,from_name,from_email,reply_to,user_id")
          .eq("id", r.autoresponder_id)
          .maybeSingle();

        if (arErr) throw arErr;

        const fromEmail = s(ar?.from_email) || "no-reply@gr8result.com";
        const fromName = s(ar?.from_name) || "GR8 RESULT";
        const replyTo = s(ar?.reply_to) || fromEmail;

        const html = await readHtmlFromStorage(r.template_path);

        // 4) Send
        const msg = {
          to: s(r.to_email),
          from: { email: fromEmail, name: fromName },
          replyTo: replyTo ? { email: replyTo } : undefined,
          subject: s(r.subject) || " ",
          html,

          // Critical: attributes events back to user + autoresponder + queue row
          customArgs: {
            user_id: s(r.user_id),
            automation_id: s(r.autoresponder_id),
            send_id: s(r.id),
            subscriber_id: s(r.lead_id),
            list_id: s(r.list_id),
            source: "autoresponder",
          },
        };

        const resp = await sgMail.send(msg);

        // SendGrid response headers contain x-message-id often
        const provider_message_id =
          s(resp?.[0]?.headers?.["x-message-id"]) ||
          s(resp?.[0]?.headers?.["X-Message-Id"]) ||
          null;

        await supabaseAdmin
          .from("email_autoresponder_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id,
            last_error: null,
          })
          .eq("id", id);

        sent += 1;
      } catch (e) {
        const errMsg = s(e?.response?.body?.errors?.[0]?.message) || s(e?.message) || String(e);

        await supabaseAdmin
          .from("email_autoresponder_queue")
          .update({
            status: "failed",
            attempts: Number(r.attempts || 0) + 1,
            last_error: errMsg.slice(0, 500),
          })
          .eq("id", id);

        failed += 1;
      }
    }

    return res.status(200).json({ ok: true, processed: items.length, sent, failed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
