// /pages/api/email/autoresponders/process-queue.js
// FULL REPLACEMENT
//
// ✅ Processes email_autoresponder_queue (queued + pending)
// ✅ Claims a job safely (only updates if status is queued/pending) to prevent double-send
// ✅ Marks rows sent/failed, increments attempts, stores provider_message_id
// ✅ Keeps sent rows for audit + analytics (default)
// ✅ Optional cleanup: ?delete_sent=1 deletes SENT rows after sending (NOT recommended)
// ✅ Auth: Authorization: Bearer <AUTORESPONDER_CRON_SECRET> OR x-cron-key OR ?key=
//
// ENV required:
//  - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY)
//  - SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)
// Optional:
//  - SENDGRID_FROM_EMAIL
//  - SENDGRID_FROM_NAME
//  - AUTORESPONDER_CRON_SECRET (or AUTOMATION_CRON_SECRET)
//  - EMAIL_ASSETS_BUCKET (optional; default "email-user-assets")

import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE ||
  "";

const CRON_SECRET =
  process.env.AUTORESPONDER_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;

const SENDGRID_API_KEY =
  process.env.SENDGRID_API_KEY ||
  process.env.GR8_MAIL_SEND_ONLY ||
  process.env.SENDGRID_KEY ||
  "";

const BUCKET = (process.env.EMAIL_ASSETS_BUCKET || "email-user-assets").trim();

function getApiKey() {
  return SENDGRID_API_KEY;
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

  const bucketsToTry = [BUCKET, "email-user-assets", "email_templates", "templates", "emails"];

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
  if (req.method !== "GET" && req.method !== "POST") {
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
      .from("email_autoresponder_queue")
      .select(
        "id, user_id, autoresponder_id, list_id, lead_id, to_email, subject, template_path, scheduled_at, status, attempts, last_error"
      )
      .in("status", ["queued", "pending"])
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: `Queue fetch failed: ${e?.message || String(e)}` });
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
