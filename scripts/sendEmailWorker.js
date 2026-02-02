/**
 * scripts/sendEmailWorker.js
 * Conservative worker: SKIPS any send that has no subject AND no HTML body.
 *
 * - Uses your server admin client at ../utils/supabase-admin (must exist and export supabaseAdmin).
 * - Marks skipped rows with status = 'skipped_no_content' and processed_at so they won't be resent.
 * - Sends rows that have at least a subject or HTML body.
 *
 * Requirements:
 * - SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY available to utils/supabase-admin
 * - SENDGRID_API_KEY in env
 *
 * Usage:
 *  - Stop any running worker (Ctrl+C in the terminal running it).
 *  - node scripts/run-worker.js   (recommended, loads .env/.env.local then spawns this file)
 *  - or node scripts/sendEmailWorker.js (if you run directly and envs are present)
 *
 * NOTE: Do not commit any secret environment files (.env/.env.local).
 */

const path = require("path");
const sgMail = require("@sendgrid/mail");
const { setTimeout: wait } = require("timers/promises");

// Import your Supabase admin client; adjust path if your utils folder is elsewhere
const { supabaseAdmin } = require(path.join(__dirname, "..", "utils", "supabase-admin"));

const POLL_LIMIT = parseInt(process.env.WORKER_LIMIT || "50", 10);
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_INTERVAL_MS || "5000", 10);

const DEFAULT_FROM = process.env.DEFAULT_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || "no-reply@localhost";
const DEFAULT_FROM_NAME = process.env.DEFAULT_FROM_NAME || process.env.SENDGRID_FROM_NAME || "No Reply";

if (!process.env.SENDGRID_API_KEY) {
  console.error("[sendEmailWorker] Missing SENDGRID_API_KEY in environment. Worker exiting.");
  process.exit(1);
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function extractSgMessageId(sendResponse) {
  try {
    if (!sendResponse) return null;
    const maybe = Array.isArray(sendResponse) ? sendResponse[0] : sendResponse;
    const headers = (maybe && maybe.headers) || (maybe && maybe[1] && maybe[1].headers) || null;
    if (!headers) return null;
    return headers["x-message-id"] || headers["X-Message-ID"] || headers["x-msg-id"] || headers["x-sendgrid-message-id"] || null;
  } catch (err) {
    return null;
  }
}

async function buildMessageForSend(sendRow) {
  let broadcast = null;
  if (sendRow.broadcast_id) {
    const { data: bdata, error: berr } = await supabaseAdmin
      .from("email_broadcasts")
      .select("id, title, subject, html_content, from_email, from_name, preheader")
      .eq("id", sendRow.broadcast_id)
      .limit(1)
      .maybeSingle();
    if (!berr && bdata) broadcast = bdata;
  }

  const fromEmail = (broadcast && broadcast.from_email) || DEFAULT_FROM;
  const fromName = (broadcast && broadcast.from_name) || DEFAULT_FROM_NAME;
  const subject = sendRow.subject || (broadcast && (broadcast.subject || broadcast.title)) || "";
  // Prefer per-send HTML if present, otherwise broadcast html_content
  const html = sendRow.bodyHtml || sendRow.body || (broadcast && broadcast.html_content) || "";

  return { fromEmail, fromName, subject, html, broadcast };
}

async function processBatch() {
  const { data: rows, error } = await supabaseAdmin
    .from("email_sends")
    .select("*")
    .is("processed_at", null)
    .limit(POLL_LIMIT)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[sendEmailWorker] Error fetching pending sends:", error);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  for (const s of rows) {
    try {
      const { fromEmail, fromName, subject, html } = await buildMessageForSend(s);

      const hasSubject = (subject || "").toString().trim().length > 0;
      const hasHtml = (html || "").toString().trim().length > 0;

      // Skip rows that have neither subject nor HTML (avoid sending blank emails)
      if (!hasSubject && !hasHtml) {
        console.log("[sendEmailWorker] Skipping send (no content):", s.id, s.email);
        await supabaseAdmin
          .from("email_sends")
          .update({
            processed_at: new Date().toISOString(),
            status: "skipped_no_content",
            error_message: "Skipped by worker: no subject and no bodyHtml",
          })
          .eq("id", s.id)
          .is("processed_at", null); // idempotency guard
        continue;
      }

      const msg = {
        to: s.email,
        from: { email: fromEmail, name: fromName },
        subject: hasSubject ? subject : "(No subject)",
        html: hasHtml ? html : "<div></div>",
        customArgs: {
          gr8_send_row_id: s.id,
          broadcast_id: s.broadcast_id || null,
        },
      };

      const sandboxEnabled = Boolean(
        s.sandbox ||
        s.use_sandbox ||
        process.env.WORKER_SANDBOX === "1" ||
        process.env.WORKER_SANDBOX === "true"
      );
      if (sandboxEnabled) msg.mailSettings = { sandboxMode: { enable: true } };

      let resp;
      try {
        resp = await sgMail.send(msg);
      } catch (sendErr) {
        console.error("[sendEmailWorker] SendGrid error for", s.id, sendErr && sendErr.message ? sendErr.message : sendErr);
        await supabaseAdmin
          .from("email_sends")
          .update({
            status: "failed",
            error_message: sendErr?.message || String(sendErr),
            processed_at: new Date().toISOString(),
          })
          .eq("id", s.id)
          .is("processed_at", null);
        continue;
      }

      const sgMessageId = extractSgMessageId(resp) || null;
      const { error: updErr } = await supabaseAdmin
        .from("email_sends")
        .update({
          processed_at: new Date().toISOString(),
          status: "processed",
          sendgrid_message_id: sgMessageId,
          error_message: null,
        })
        .eq("id", s.id)
        .is("processed_at", null);

      if (updErr) {
        console.error("[sendEmailWorker] Failed to update send row", s.id, updErr);
      } else {
        console.log("[sendEmailWorker] Processed send", s.id, "-> sg_message_id:", sgMessageId);
      }
    } catch (err) {
      console.error("[sendEmailWorker] Unexpected error processing send", s && s.id, err && err.message ? err.message : err);
      // continue processing other rows
    }
  }

  return rows.length;
}

(async function main() {
  console.log("[sendEmailWorker] starting worker (poll interval ms:", POLL_INTERVAL_MS, ", limit:", POLL_LIMIT, ")");
  while (true) {
    try {
      const processed = await processBatch();
      if (processed === 0) {
        await wait(POLL_INTERVAL_MS);
      } else {
        await wait(1000);
      }
    } catch (err) {
      console.error("[sendEmailWorker] worker loop error:", err && err.message ? err.message : err);
      await wait(5000);
    }
  }
})();