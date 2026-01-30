/**
 * scripts/sendEmailWorker.js
 * Full replacement (CommonJS) — polls public.email_sends for unprocessed rows and sends via SendGrid.
 *
 * Requirements (server env):
 * - SUPABASE_URL (used by your utils/supabase-admin)
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SENDGRID_API_KEY
 * - DEFAULT_FROM_EMAIL (optional)
 * - DEFAULT_FROM_NAME  (optional)
 * - WORKER_LIMIT (optional, default 50)
 * - WORKER_INTERVAL_MS (optional, default 5000)
 * - WORKER_SANDBOX (optional, "1" or "true" to default all sends to sandbox)
 *
 * Install deps:
 *   npm install @sendgrid/mail
 *
 * Usage:
 *   node scripts/sendEmailWorker.js
 *
 * Note:
 * - This file requires ../utils/supabase-admin to exist and export supabaseAdmin (your existing file).
 * - It intentionally avoids exposing any secrets.
 */

const path = require("path");
const sgMail = require("@sendgrid/mail");
const { setTimeout: wait } = require("timers/promises");

// import server admin client (adjust path if your utils directory is different)
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

/**
 * Extract SendGrid message id from send response (varies by sdk/version and transport)
 * @param {*} sendResponse
 * @returns {string|null}
 */
function extractSgMessageId(sendResponse) {
  try {
    if (!sendResponse) return null;
    // @sendgrid/mail typically returns an array of responses
    const maybe = Array.isArray(sendResponse) ? sendResponse[0] : sendResponse;
    const headers = (maybe && maybe.headers) || (maybe && maybe[1] && maybe[1].headers) || null;
    if (!headers) return null;
    return headers["x-message-id"] || headers["X-Message-ID"] || headers["x-msg-id"] || headers["x-sendgrid-message-id"] || null;
  } catch (err) {
    return null;
  }
}

/**
 * Build message body and metadata for a send row
 */
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
  const subject = sendRow.subject || (broadcast && (broadcast.subject || broadcast.title)) || "No subject";
  const html = sendRow.bodyHtml || sendRow.body || (broadcast && broadcast.html_content) || "<div></div>";

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

      const msg = {
        to: s.email,
        from: { email: fromEmail, name: fromName },
        subject,
        html,
        // custom args to help webhook matching
        customArgs: {
          gr8_send_row_id: s.id,
          broadcast_id: s.broadcast_id || null,
        },
      };

      // determine sandbox: either per-row or global env override
      const sandboxEnabled = Boolean(
        s.sandbox ||
        s.use_sandbox ||
        process.env.WORKER_SANDBOX === "1" ||
        process.env.WORKER_SANDBOX === "true"
      );
      if (sandboxEnabled) {
        msg.mailSettings = { sandboxMode: { enable: true } };
      }

      let resp;
      try {
        resp = await sgMail.send(msg);
      } catch (sendErr) {
        // mark row as failed but processed so it doesn't get stuck in the queue
        console.error("[sendEmailWorker] SendGrid send error for", s.id, sendErr && sendErr.message ? sendErr.message : sendErr);

        await supabaseAdmin
          .from("email_sends")
          .update({
            status: "failed",
            error_message: sendErr?.message || String(sendErr),
            processed_at: new Date().toISOString(),
          })
          .eq("id", s.id)
          .is("processed_at", null);

        continue; // move to next row
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
      // don't crash the loop
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