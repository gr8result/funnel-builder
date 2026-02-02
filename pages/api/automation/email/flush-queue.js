// /pages/api/cron/flush-queue.js  (or whatever your SEND endpoint file is)
// FULL REPLACEMENT
//
// ✅ NO run_at used (your table doesn't have it)
// ✅ Pulls queued items by status + created_at ordering
// ✅ Does NOT assume html column exists
// ✅ Returns clean JSON always (fixes "No JSON")
//
// IMPORTANT:
// - This file only "flushes" what is ALREADY in automation_email_queue.
// - If nothing is inserting into automation_email_queue, the problem is your TICK endpoint.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const SERVICE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE ||
    "").trim();

const SENDGRID_KEY =
  process.env.GR8_MAIL_SEND_ONLY || process.env.SENDGRID_API_KEY;

const DEFAULT_FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL || "no-reply@gr8result.com";
const DEFAULT_FROM_NAME =
  process.env.SENDGRID_FROM_NAME || "GR8 RESULT";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sendSendgrid({ to, subject, html, fromEmail, fromName, customArgs }) {
  if (!SENDGRID_KEY) throw new Error("Missing SENDGRID_API_KEY / GR8_MAIL_SEND_ONLY");
  if (!to) throw new Error("Missing to email");

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail || DEFAULT_FROM_EMAIL, name: fromName || DEFAULT_FROM_NAME },
    subject: subject || "Hello",
    content: [{ type: "text/html", value: html || "<p>Hello</p>" }],
    ...(customArgs ? { custom_args: customArgs } : {}),
  };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const status = resp.status;
  const text = await resp.text().catch(() => "");
  if (status !== 202) {
    throw new Error(`SendGrid rejected (${status}): ${text.slice(0, 800)}`);
  }
  return {
    ok: true,
    status,
    message_id: resp.headers.get("x-message-id") || null,
  };
}

export default async function handler(req, res) {
  try {
    // allow GET or POST (scheduler scripts vary)
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "Use GET or POST" });
    }

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SERVICE ROLE key" });
    }

    // Pull rows that are queued/pending (NO run_at)
    const { data: rows, error } = await supabaseAdmin
      .from("automation_email_queue")
      .select("*")
      .in("status", ["queued", "pending"])
      .order("created_at", { ascending: true })
      .limit(25);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    let processed = 0;
    let sent = 0;
    let failed = 0;
    const results = [];

    for (const r of rows || []) {
      processed += 1;
      const id = r.id;

      try {
        // Mark "sending" if you have that status (safe even if not used elsewhere)
        await supabaseAdmin
          .from("automation_email_queue")
          .update({ status: "sending", updated_at: new Date().toISOString() })
          .eq("id", id);

        // Fetch user's business email from accounts table
        let fromEmail = DEFAULT_FROM_EMAIL;
        let fromName = DEFAULT_FROM_NAME;
        
        if (r.user_id) {
          const { data: account } = await supabaseAdmin
            .from("accounts")
            .select("sendgrid_from_email,business_email,business_name,name")
            .eq("user_id", r.user_id)
            .maybeSingle();
          
          if (account) {
            // Prefer sendgrid_from_email, fallback to business_email
            fromEmail = account.sendgrid_from_email || account.business_email || DEFAULT_FROM_EMAIL;
            fromName = account.business_name || account.name || fromEmail;
          }
        }

        const to = r.to_email || r.email || r.recipient || r.to || null;
        const subject = r.subject || r.email_subject || "Hello";
        const html = r.html_content || r.body_html || r.html_body || r.content_html || r.content || "<p>Hello</p>";

        const sg = await sendSendgrid({
          to,
          subject,
          html,
          fromEmail,
          fromName,
          customArgs: {
            automation_queue_id: id,
            automation_flow_id: r.flow_id,
            automation_node_id: r.node_id,
            automation_lead_id: r.lead_id,
            automation_user_id: r.user_id,
          },
        });

        // Mark sent
        await supabaseAdmin
          .from("automation_email_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sendgrid_message_id: sg.message_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        sent += 1;
        results.push({ id, ok: true });
      } catch (e) {
        failed += 1;

        // Mark failed (do NOT assume there is an error column)
        await supabaseAdmin
          .from("automation_email_queue")
          .update({
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        results.push({ id, ok: false, error: String(e?.message || e).slice(0, 300) });
      }
    }

    return res.status(200).json({
      ok: true,
      processed,
      sent,
      failed,
      selected: rows?.length || 0,
      env: { hasSendgridKey: !!SENDGRID_KEY },
      results,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
