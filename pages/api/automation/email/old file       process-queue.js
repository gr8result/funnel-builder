// /pages/api/automation/email/process-queue.js
// FULL REPLACEMENT
//
// ✅ Processes public.automation_email_queue and sends emails via SendGrid
// ✅ Auth: cron secret OR logged-in Supabase Bearer token
// ✅ No localhost hardcoding
// ✅ Handles base64 html_content reliably
//
// POST body optional:
//  { max: 50 }
//
// ENV:
//  NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  SUPABASE_SERVICE_ROLE_KEY (or variants)
//  SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)
//  AUTOMATION_CRON_SECRET (or AUTOMATION_CRON_KEY / CRON_SECRET)
//  DEFAULT_FROM_EMAIL (optional)
//  DEFAULT_FROM_NAME (optional)

import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const SERVICE_KEY =
  (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE ||
    ""
  ).trim();

const SENDGRID_KEY = (
  process.env.SENDGRID_API_KEY ||
  process.env.GR8_MAIL_SEND_ONLY ||
  ""
).trim();

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function getBearer(req) {
  const h = String(req.headers.authorization || "").trim();
  const m = h.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

async function bearerIsValidUserJwt(token) {
  if (!token) return false;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    return !error && !!data?.user?.id;
  } catch {
    return false;
  }
}

async function okAuth(req) {
  // 1) Cron secret ways
  const q = String(req.query?.key || "").trim();
  const x = String(req.headers["x-cron-key"] || "").trim();
  const bearer = getBearer(req);

  if (!CRON_SECRET) {
    // dev-safe: if you didn't set a secret, allow
    return true;
  }

  if (q && q === CRON_SECRET) return true;
  if (x && x === CRON_SECRET) return true;
  if (bearer && bearer === CRON_SECRET) return true;

  // 2) Logged-in session JWT (Supabase)
  if (bearer) {
    const ok = await bearerIsValidUserJwt(bearer);
    if (ok) return true;
  }

  return false;
}

function decodeHtmlMaybe(html) {
  if (!html) return "";

  // If your tick stored raw base64 (no prefix), decode safely
  // Only decode if it *looks* like base64 and decoding produces HTML-ish content.
  const s = String(html);

  // If someone stored "base64:...."
  if (s.startsWith("base64:")) {
    try {
      return Buffer.from(s.slice(7), "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  // Raw base64 heuristic
  const base64ish =
    s.length > 80 &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(s) &&
    !s.includes("<html") &&
    !s.includes("<body") &&
    !s.includes("<div");

  if (base64ish) {
    try {
      const decoded = Buffer.from(s, "base64").toString("utf8");
      if (decoded.includes("<") && decoded.toLowerCase().includes("html")) {
        return decoded;
      }
      if (decoded.includes("<") && (decoded.includes("</") || decoded.includes("<div"))) {
        return decoded;
      }
    } catch {
      // ignore
    }
  }

  // Already plain HTML
  return s;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env",
      need: ["NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)", "SUPABASE_SERVICE_ROLE_KEY (or variants)"],
    });
  }

  const authed = await okAuth(req);
  if (!authed) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!SENDGRID_KEY) {
    return res.status(500).json({ ok: false, error: "SendGrid API key not configured" });
  }

  try {
    sgMail.setApiKey(SENDGRID_KEY);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SendGrid init failed: " + msg(e) });
  }

  const maxEmails = Math.min(parseInt(req.body?.max || "50", 10) || 50, 200);

  // Fetch pending emails
  const { data: emails, error: fetchErr } = await supabaseAdmin
    .from("automation_email_queue")
    .select("*")
    .in("status", ["pending", "queued"])
    .order("created_at", { ascending: true })
    .limit(maxEmails);

  if (fetchErr) {
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch queued emails: " + msg(fetchErr),
    });
  }

  const list = Array.isArray(emails) ? emails : [];
  if (list.length === 0) {
    return res.json({
      ok: true,
      processed: 0,
      sent: 0,
      failed: 0,
      message: "No pending emails in automation_email_queue",
    });
  }

  let sent = 0;
  let failed = 0;
  const failed_ids = [];

  for (const row of list) {
    let sendRowId = null;

    try {
      // decode html_content
      const html = decodeHtmlMaybe(row.html_content);

      if (!html) throw new Error("No HTML content available (html_content empty)");

      // optional: log into email_sends
      try {
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("email_sends")
          .insert({
            user_id: row.user_id || null,
            email: row.to_email,
            recipient_email: row.to_email,
            variant: row.variant || row.node_id || null,
            subject: row.subject || null,
            email_type: "automation",
            status: "queued",
            sent_at: null,
            automation_id: row.flow_id || null,
          })
          .select("id")
          .single();

        if (!insErr && inserted?.id) sendRowId = inserted.id;
      } catch {
        // don't block
      }

      const fromEmail = process.env.DEFAULT_FROM_EMAIL || "noreply@gr8result.com";
      const fromName = process.env.DEFAULT_FROM_NAME || "GR8 Result";

      const sgMsg = {
        to: row.to_email,
        from: { email: fromEmail, name: fromName },
        subject: row.subject || "Message",
        html,
        customArgs: {
          gr8_send_row_id: sendRowId || undefined,
          source: "automation",
          flow_id: row.flow_id || undefined,
          node_id: row.node_id || undefined,
          lead_id: row.lead_id || undefined,
          variant: row.variant || undefined,
        },
      };

      await sgMail.send(sgMsg);

      // mark queue row sent
      await supabaseAdmin
        .from("automation_email_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);

      // mark email_sends sent
      if (sendRowId) {
        await supabaseAdmin
          .from("email_sends")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", sendRowId);
      }

      sent++;
    } catch (e) {
      const errMsg = msg(e);
      failed++;
      failed_ids.push(row.id);

      await supabaseAdmin
        .from("automation_email_queue")
        .update({
          status: "failed",
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (sendRowId) {
        await supabaseAdmin
          .from("email_sends")
          .update({
            status: "failed",
            error_message: errMsg,
          })
          .eq("id", sendRowId);
      }
    }
  }

  return res.json({
    ok: true,
    processed: list.length,
    sent,
    failed,
    failed_ids,
  });
}
