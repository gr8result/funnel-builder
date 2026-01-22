// /pages/api/email/autoresponders/process-queue.js
// FULL REPLACEMENT
//
<<<<<<< HEAD
// ✅ Processes email_autoresponder_queue (queued + pending)
// ✅ Claims a job safely (only updates if status is queued/pending) to prevent double-send
// ✅ Marks rows sent/failed, increments attempts, stores provider_message_id
// ✅ Keeps sent rows for audit + analytics (default)
// ✅ Optional cleanup: ?delete_sent=1 deletes SENT rows after sending (NOT recommended)
// ✅ Auth: Authorization: Bearer <AUTORESPONDER_CRON_SECRET> OR x-cron-key OR ?key=
=======
// FIXES:
// ✅ Processes BOTH 'pending' and 'queued' (your table currently uses 'pending')
// ✅ Claims rows safely to prevent duplicate sending
// ✅ Updates: pending/queued -> sending -> sent/failed
// ✅ Stores provider_message_id + last_error + attempts
// ✅ Reads HTML from Supabase Storage using template_path
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
//
// ENV required:
//  - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
<<<<<<< HEAD
//  - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY)
//  - SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)
// Optional:
//  - SENDGRID_FROM_EMAIL
//  - SENDGRID_FROM_NAME
//  - AUTORESPONDER_CRON_SECRET (or AUTOMATION_CRON_SECRET)
=======
//  - SUPABASE_SERVICE_ROLE_KEY (or SERVICE ROLE variants)
//  - SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)
//  - AUTOMATION_CRON_SECRET (or CRON_SECRET)
//  - EMAIL_ASSETS_BUCKET (optional; default "email-user-assets")
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
<<<<<<< HEAD
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;
=======
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE ||
  "";
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

const CRON_SECRET =
  process.env.AUTORESPONDER_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;

<<<<<<< HEAD
function getApiKey() {
  return process.env.SENDGRID_API_KEY || process.env.GR8_MAIL_SEND_ONLY || "";
}

function readAuthKey(req) {
  const h1 = req.headers.authorization || "";
  const bearer = h1.toLowerCase().startsWith("bearer ")
    ? h1.slice(7).trim()
    : "";
  const h2 = req.headers["x-cron-key"]
    ? String(req.headers["x-cron-key"]).trim()
    : "";
  const q = req.query?.key ? String(req.query.key).trim() : "";
  return bearer || h2 || q || "";
}

function nowIso() {
  return new Date().toISOString();
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function isDue(row) {
  const s = row?.scheduled_at ? new Date(row.scheduled_at).getTime() : null;
  if (!s) return true;
  return s <= Date.now();
}

async function loadHtmlFromStorage(supabase, templatePath) {
  const path = safeStr(templatePath);
  if (!path) return "";

  const bucketsToTry = ["email-user-assets", "email_templates", "templates", "emails"];

  for (const bucket of bucketsToTry) {
    try {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) continue;

      const ab = await data.arrayBuffer();
      const html = Buffer.from(ab).toString("utf8");
      if (html && html.length > 5) return html;
    } catch {
      // try next
    }
  }

  return "";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Auth
  if (CRON_SECRET) {
    const k = readAuthKey(req);
    if (!k || k !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized (cron secret)" });
    }
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res
      .status(500)
      .json({ ok: false, error: "Missing SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)" });
  }
  sgMail.setApiKey(apiKey);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 25)));
  const deleteSent = String(req.query.delete_sent || "") === "1";

  // Pull queued/pending rows
  let rows = [];
  try {
    const { data, error } = await supabase
=======
const SENDGRID_API_KEY =
  process.env.SENDGRID_API_KEY ||
  process.env.GR8_MAIL_SEND_ONLY ||
  process.env.SENDGRID_KEY ||
  "";

const BUCKET = (process.env.EMAIL_ASSETS_BUCKET || "email-user-assets").trim();

function s(v) {
  return String(v ?? "").trim();
}

function isAuthed(req) {
  if (!CRON_SECRET) return false;
  const q = s(req.query?.key);
  const h = s(req.headers["x-cron-key"]);
  const a = s(req.headers.authorization || "");
  const bearer = a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
  const key = q || h || bearer;
  return key === CRON_SECRET;
}

const supabaseAdmin =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

async function readHtmlFromStorage(template_path) {
  const path = s(template_path);
  if (!path) throw new Error("Missing template_path");

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error) throw error;
  if (!data) throw new Error("Storage download returned empty file");

  // Supabase Storage download returns a Blob-like response in Node
  const buf = await data.arrayBuffer();
  const html = Buffer.from(buf).toString("utf-8");
  if (!html || !html.trim()) throw new Error("Template HTML is empty");
  return html;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "POST or GET only" });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE SERVICE ROLE key env vars",
    });
  }

  if (!isAuthed(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized (cron secret)" });
  }

  const sg = s(SENDGRID_API_KEY);
  if (!sg || !sg.startsWith("SG.")) {
    return res.status(500).json({
      ok: false,
      error: "Missing/invalid SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY). Must start with SG.",
    });
  }

  sgMail.setApiKey(sg);

  try {
    const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);
    const nowIso = new Date().toISOString();

    // 1) Load due items (IMPORTANT: pending OR queued)
    const { data: rows, error: qErr } = await supabaseAdmin
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
      .from("email_autoresponder_queue")
      .select(
        "id, user_id, autoresponder_id, list_id, lead_id, to_email, subject, template_path, scheduled_at, status, attempts, last_error"
      )
<<<<<<< HEAD
      .in("status", ["queued", "pending"])
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `Queue fetch failed: ${e?.message || String(e)}` });
=======
      .in("status", ["pending", "queued"])
      .lte("scheduled_at", nowIso)
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
        note: "No pending/queued rows ready to send.",
      });
    }

    let sent = 0;
    let failed = 0;
    const results = [];

    for (const r of items) {
      const id = r.id;

      // 2) Claim row (avoid double sending)
      const { data: claimed, error: cErr } = await supabaseAdmin
        .from("email_autoresponder_queue")
        .update({
          status: "sending",
          attempts: Number(r.attempts || 0) + 1,
          last_error: null,
        })
        .eq("id", id)
        .in("status", ["pending", "queued"])
        .select("id")
        .maybeSingle();

      if (cErr) {
        failed += 1;
        results.push({ id, ok: false, stage: "claim", error: cErr.message });
        continue;
      }
      if (!claimed?.id) {
        // someone else claimed it
        continue;
      }

      try {
        const toEmail = s(r.to_email);
        if (!toEmail || !toEmail.includes("@")) throw new Error("Missing/invalid to_email");
        const subject = s(r.subject) || " ";

        // 3) Load autoresponder sender defaults
        const { data: ar, error: arErr } = await supabaseAdmin
          .from("email_automations")
          .select("id,from_name,from_email,reply_to")
          .eq("id", r.autoresponder_id)
          .maybeSingle();

        if (arErr) throw arErr;

        const fromEmail = s(ar?.from_email) || "no-reply@gr8result.com";
        const fromName = s(ar?.from_name) || "GR8 RESULT";
        const replyTo = s(ar?.reply_to) || fromEmail;

        // 4) Load HTML
        const html = await readHtmlFromStorage(r.template_path);

        // 5) Send
        const resp = await sgMail.send({
          to: toEmail,
          from: { email: fromEmail, name: fromName },
          replyTo: replyTo ? { email: replyTo } : undefined,
          subject,
          html,
          customArgs: {
            user_id: s(r.user_id),
            automation_id: s(r.autoresponder_id),
            queue_id: s(r.id),
            lead_id: s(r.lead_id),
            list_id: s(r.list_id),
            source: "autoresponder",
          },
        });

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
        results.push({ id, ok: true, provider_message_id });
      } catch (e) {
        const errMsg =
          s(e?.response?.body?.errors?.[0]?.message) || s(e?.message) || String(e);

        await supabaseAdmin
          .from("email_autoresponder_queue")
          .update({
            status: "failed",
            last_error: errMsg.slice(0, 500),
          })
          .eq("id", id);

        failed += 1;
        results.push({ id, ok: false, stage: "send", error: errMsg });
      }
    }

    return res.status(200).json({
      ok: true,
      processed: sent + failed,
      sent,
      failed,
      results,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
  }

  const due = rows.filter(isDue);

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const results = [];

  const fromEmail = safeStr(process.env.SENDGRID_FROM_EMAIL) || "no-reply@gr8result.com";
  const fromName = safeStr(process.env.SENDGRID_FROM_NAME) || "GR8 RESULT";

  for (const row of due) {
    processed += 1;

    const id = row.id;
    const to = safeStr(row.to_email);
    const subject = safeStr(row.subject) || " ";
    const templatePath = safeStr(row.template_path);

    if (!to || !to.includes("@")) {
      failed += 1;
      results.push({ id, ok: false, error: "Missing/invalid to_email" });
      await supabase
        .from("email_autoresponder_queue")
        .update({
          status: "failed",
          attempts: Number(row.attempts || 0) + 1,
          last_error: "Missing/invalid to_email",
        })
        .eq("id", id);
      continue;
    }

    // ✅ Claim the job safely (only if still queued/pending)
    const { data: claimed, error: claimErr } = await supabase
      .from("email_autoresponder_queue")
      .update({ status: "processing" })
      .eq("id", id)
      .in("status", ["queued", "pending"])
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed?.id) {
      // Someone else claimed it (or it changed); skip
      results.push({ id, ok: false, error: "Not claimed (already processing?)" });
      continue;
    }

    try {
      let html = await loadHtmlFromStorage(supabase, templatePath);
      if (!html) {
        if (templatePath.startsWith("<") && templatePath.includes("</")) {
          html = templatePath;
        }
      }
      if (!html) throw new Error("Template HTML not found (template_path)");

      const msg = {
        to,
        from: { email: fromEmail, name: fromName },
        subject,
        html,
      };

      const resp = await sgMail.send(msg);
      const providerId =
        resp?.[0]?.headers?.["x-message-id"] ||
        resp?.[0]?.headers?.["X-Message-Id"] ||
        null;

      sent += 1;
      results.push({ id, ok: true, provider_message_id: providerId || null });

      await supabase
        .from("email_autoresponder_queue")
        .update({
          status: "sent",
          sent_at: nowIso(),
          provider_message_id: providerId || null,
          last_error: null,
        })
        .eq("id", id);
    } catch (e) {
      failed += 1;
      const errMsg = String(e?.message || e);

      results.push({ id, ok: false, error: errMsg });

      await supabase
        .from("email_autoresponder_queue")
        .update({
          status: "queued", // retry later
          attempts: Number(row.attempts || 0) + 1,
          last_error: errMsg,
        })
        .eq("id", id);
    }
  }

  if (deleteSent && sent > 0) {
    const sentIds = results.filter((r) => r.ok).map((r) => r.id);
    if (sentIds.length) {
      await supabase.from("email_autoresponder_queue").delete().in("id", sentIds);
    }
  }

  return res.status(200).json({
    ok: true,
    processed,
    sent,
    failed,
    results,
    note: deleteSent
      ? "delete_sent=1 was enabled (sent rows removed)."
      : "Sent rows are kept for history + analytics. Use ?delete_sent=1 to delete them.",
  });
}
