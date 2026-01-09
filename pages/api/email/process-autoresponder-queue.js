// /pages/api/email/process-autoresponder-queue.js
// FULL REPLACEMENT
//
// ✅ Sends queued autoresponder emails from public.email_autoresponder_queue
// ✅ Pulls HTML from Supabase Storage (bucket: email-user-assets) using template_path
// ✅ Uses SendGrid API to send
// ✅ Updates queue row status: queued -> sending -> sent/failed
//
// ENV required:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - SENDGRID_API_KEY
// - SENDGRID_FROM_EMAIL (optional fallback)
// - SENDGRID_FROM_NAME (optional fallback)

import { createClient } from "@supabase/supabase-js";
import sgMail from "@sendgrid/mail";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

const BUCKET = "email-user-assets";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "POST or GET only" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      });
    }
    if (!SENDGRID_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing env: SENDGRID_API_KEY" });
    }

    sgMail.setApiKey(SENDGRID_API_KEY);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10) || 10, 1),
      50
    );

    // 1) Pull due items
    const { data: rows, error: qErr } = await supabaseAdmin
      .from("email_autoresponder_queue")
      .select("*")
      .eq("status", "queued")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(limit);

    if (qErr) throw qErr;

    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
      return res.status(200).json({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        message: "No due autoresponder emails.",
      });
    }

    let sent = 0;
    let failed = 0;
    const results = [];

    for (const item of items) {
      const id = item.id;

      // Mark as sending (best-effort lock)
      await supabaseAdmin
        .from("email_autoresponder_queue")
        .update({
          status: "sending",
          attempts: (item.attempts || 0) + 1,
          last_error: null,
        })
        .eq("id", id);

      try {
        if (!item.template_path) {
          throw new Error("Missing template_path on queue item.");
        }

        // 2) Load HTML from Storage
        const { data: fileData, error: dlErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .download(item.template_path);

        if (dlErr) throw dlErr;
        if (!fileData) throw new Error("Storage download returned empty file.");

        const html = await fileData.text();
        if (!html || !html.trim()) throw new Error("Template HTML is empty.");

        // 3) Determine From details
        // If your email_automations stores from_name/from_email, use them.
        // We’ll fetch the autoresponder row for better defaults.
        let fromEmail =
          process.env.SENDGRID_FROM_EMAIL || "no-reply@gr8result.com";
        let fromName = process.env.SENDGRID_FROM_NAME || "GR8 RESULT";

        if (item.autoresponder_id) {
          const { data: ar, error: arErr } = await supabaseAdmin
            .from("email_automations")
            .select("from_email, from_name, reply_to")
            .eq("id", item.autoresponder_id)
            .single();

          if (!arErr && ar) {
            if (ar.from_email) fromEmail = ar.from_email;
            if (ar.from_name) fromName = ar.from_name;
          }
        }

        const msg = {
          to: item.to_email,
          from: { email: fromEmail, name: fromName },
          subject: item.subject || "Hello",
          html,
        };

        const [resp] = await sgMail.send(msg);

        const providerId =
          resp?.headers?.["x-message-id"] ||
          resp?.headers?.["X-Message-Id"] ||
          null;

        await supabaseAdmin
          .from("email_autoresponder_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: providerId,
            last_error: null,
          })
          .eq("id", id);

        sent += 1;
        results.push({ id, ok: true, provider_message_id: providerId });
      } catch (e) {
        failed += 1;

        await supabaseAdmin
          .from("email_autoresponder_queue")
          .update({
            status: "failed",
            last_error: String(e?.message || e),
          })
          .eq("id", id);

        results.push({ id, ok: false, error: String(e?.message || e) });
      }
    }

    return res.status(200).json({
      ok: true,
      processed: items.length,
      sent,
      failed,
      results,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unknown error",
    });
  }
}
