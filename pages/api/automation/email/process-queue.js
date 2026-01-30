// /pages/api/automation/email/process-queue.js
// POST endpoint to process automation_email_queue and send emails via SendGrid
// Called as a cron job or manually to flush pending emails

import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SENDGRID_KEY = (
  process.env.SENDGRID_API_KEY || 
  process.env.GR8_MAIL_SEND_ONLY || 
  ""
).trim();

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn("Missing SUPABASE env vars");
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getBearer(req) {
  const h = (req.headers.authorization || "").trim();
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

function okAuth(req) {
  const bearer = getBearer(req);
  const q = (req.query.key || "").toString().trim();
  const x = (req.headers["x-cron-key"] || "").toString().trim();
  const secret = CRON_SECRET;
  // Accept: valid bearer token OR cron secret
  if (bearer) return true; // Authenticated user
  if (!secret) return true; // dev-safe
  return q === secret || x === secret;
}

async function loadHtmlFromStorage(supabase, bucket, path) {
  if (!path) return "";
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return "";
    return await data.text();
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    if (!okAuth(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (!SENDGRID_KEY) {
      return res.status(500).json({
        ok: false,
        error: "SendGrid API key not configured",
      });
    }

    sgMail.setApiKey(SENDGRID_KEY);

    const maxEmails = Number(req.body?.max || 50);

    // Fetch pending emails from queue (try both status values)
    const { data: queuedEmails, error: fetchErr } = await supabaseAdmin
      .from("automation_email_queue")
      .select("*")
      .in("status", ["pending", "queued"])
      .limit(maxEmails);

    if (fetchErr) {
      console.error("Fetch error:", fetchErr);
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch queued emails: " + fetchErr.message,
        detail: fetchErr,
      });
    }

    const emails = Array.isArray(queuedEmails) ? queuedEmails : [];
    
    console.log(`Found ${emails.length} emails to process`);
    
    if (emails.length === 0) {
      return res.json({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        message: "No pending emails in queue",
        debug: { checked_table: "automation_email_queue", statuses: ["pending", "queued"] },
      });
    }

    let sent = 0;
    let failed = 0;
    const failedIds = [];

    for (const email of emails) {
      try {
        // Load HTML from storage if needed
        let htmlContent = email.html_content || "";
        
        if (!htmlContent && email.html_path) {
          const bucket = email.bucket || "email-user-assets";
          htmlContent = await loadHtmlFromStorage(
            supabaseAdmin,
            bucket,
            email.html_path
          );
        }

        // Decode base64 if needed
        if (htmlContent.startsWith("base64:")) {
          htmlContent = Buffer.from(
            htmlContent.slice(7),
            "base64"
          ).toString("utf8");
        } else if (email.html_content && typeof email.html_content === "string" && 
                   /^[A-Za-z0-9+/=]+$/.test(email.html_content) && 
                   email.html_content.length > 100) {
          // Might be base64, try to decode
          try {
            const decoded = Buffer.from(email.html_content, "base64").toString("utf8");
            if (decoded.includes("<") || decoded.includes("html")) {
              htmlContent = decoded;
            }
          } catch {
            // Keep original
          }
        }

        if (!htmlContent) {
          throw new Error("No HTML content available");
        }

        let sendRowId = null;
        try {
          const sendRow = {
            user_id: email.user_id || null,
            email: email.to_email,
            recipient_email: email.to_email,
            variant: email.node_id || email.variant || null,
            subject: email.subject || null,
            email_type: "automation",
            status: "queued",
            sent_at: null,
          };

          const { data: sendRowData, error: sendRowErr } = await supabaseAdmin
            .from("email_sends")
            .insert(sendRow)
            .select("id")
            .single();

          if (!sendRowErr && sendRowData?.id) {
            sendRowId = sendRowData.id;
          }
        } catch {
          // don't block sending if logging fails
        }

        const msg = {
          to: email.to_email,
          from: process.env.DEFAULT_FROM_EMAIL || "noreply@gr8result.com",
          replyTo: process.env.DEFAULT_REPLY_EMAIL || undefined,
          subject: email.subject || "Message",
          html: htmlContent,
          customArgs: {
            gr8_send_row_id: sendRowId || undefined,
            source: "automation",
            flow_id: email.flow_id || undefined,
            node_id: email.node_id || undefined,
            lead_id: email.lead_id || undefined,
          },
        };

        await sgMail.send(msg);

        // Mark as sent
        await supabaseAdmin
          .from("automation_email_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", email.id);

        if (sendRowId) {
          await supabaseAdmin
            .from("email_sends")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
            })
            .eq("id", sendRowId)
            .catch(() => {});
        }

        sent++;
      } catch (err) {
        console.error(`Failed to send email ${email.id}:`, err);
        failedIds.push(email.id);
        failed++;

        // Update with error
        await supabaseAdmin
          .from("automation_email_queue")
          .update({
            status: "failed",
            last_error: err.message,
          })
          .eq("id", email.id)
          .catch(() => {}); // Don't fail if update fails

        if (sendRowId) {
          await supabaseAdmin
            .from("email_sends")
            .update({
              status: "failed",
              error_message: err.message,
            })
            .eq("id", sendRowId)
            .catch(() => {});
        }
      }
    }

    return res.json({
      ok: true,
      processed: emails.length,
      sent,
      failed,
      failed_ids: failedIds,
      message: `Processed ${emails.length} queued emails: ${sent} sent, ${failed} failed`,
    });
  } catch (err) {
    console.error("process-queue error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
