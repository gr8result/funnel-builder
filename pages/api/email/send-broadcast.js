// /pages/api/email/send-broadcast.js
// FULL REPLACEMENT
//
// ✅ FIXES: 413 Body exceeded 1mb limit (Next.js API route body parser default)
// ✅ Keeps your existing behavior:
//    - Proper A/B split (A + B)
//    - Works for "emails" or "list" audience
//    - Writes email_sends rows with ab_variant + subject actually used
//    - Injects inbox preheader into HTML
//    - Uses Bearer token (Supabase user session) for auth
//
// IMPORTANT:
// - After replacing this file, you MUST restart your dev server:
//   1) Ctrl+C
//   2) npm run dev
//
// ENV required (one of these):
//   SENDGRID_API_KEY=SG....
//   OR GR8_MAIL_SEND_ONLY=SG....
//
// Optional:
//   SENDGRID_FROM_EMAIL=no-reply@gr8result.com
//   SENDGRID_FROM_NAME=GR8 RESULT

// ✅ Increase body size limit for this endpoint (fixes your 1MB error)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // adjust if needed (e.g. "10mb", "50mb")
    },
  },
};

import sgMail from "@sendgrid/mail";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

function getApiKey() {
  return process.env.SENDGRID_API_KEY || process.env.GR8_MAIL_SEND_ONLY || "";
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Preheader injection ---
// This makes inbox preview text work in Gmail/Outlook/etc.
function injectPreheader(html, preheader) {
  const text = String(preheader || "").trim();
  if (!text) return html;

  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const block =
    `<div id="gr8-preheader" ` +
    `style="display:none!important;visibility:hidden;opacity:0;color:transparent;` +
    `height:0;width:0;max-height:0;max-width:0;overflow:hidden;` +
    `mso-hide:all;font-size:1px;line-height:1px;">` +
    `${safe}` +
    `<span style="display:none!important;">` +
    `&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;` +
    `</span>` +
    `</div>`;

  const s = String(html || "");

  // If already injected, replace it
  if (s.includes('id="gr8-preheader"')) {
    return s.replace(/<div id="gr8-preheader"[\s\S]*?<\/div>/i, block);
  }

  // Insert right after <body ...> if possible
  const bodyOpen = s.match(/<body[^>]*>/i);
  if (bodyOpen) {
    const idx = bodyOpen.index + bodyOpen[0].length;
    return s.slice(0, idx) + block + s.slice(idx);
  }

  // Otherwise, just prepend
  return block + s;
}

async function getUserFromBearer(admin, req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function resolveRecipients(admin, userId, audienceType, audience, recipientsFromBody) {
  if (audienceType === "emails") {
    const rec = Array.isArray(recipientsFromBody) ? recipientsFromBody : [];
    const cleaned = rec.map((e) => String(e || "").trim()).filter(isEmail);
    return [...new Set(cleaned)];
  }

  if (audienceType === "list") {
    const listId = String(audience || "").trim();
    if (!listId) return [];

    const attempts = [
      async () => {
        const { data, error } = await admin
          .from("lead_list_members")
          .select("email")
          .eq("user_id", userId)
          .eq("list_id", listId)
          .limit(5000);
        if (error) throw error;
        return (data || []).map((r) => r.email).filter(isEmail);
      },
      async () => {
        const { data, error } = await admin
          .from("email_list_members")
          .select("email")
          .eq("user_id", userId)
          .eq("list_id", listId)
          .limit(5000);
        if (error) throw error;
        return (data || []).map((r) => r.email).filter(isEmail);
      },
      async () => {
        const { data, error } = await admin
          .from("leads")
          .select("email")
          .eq("user_id", userId)
          .eq("list_id", listId)
          .limit(5000);
        if (error) throw error;
        return (data || []).map((r) => r.email).filter(isEmail);
      },
    ];

    for (const fn of attempts) {
      try {
        const list = await fn();
        const cleaned = list.map((e) => String(e || "").trim()).filter(isEmail);
        return [...new Set(cleaned)];
      } catch {
        // try next
      }
    }

    return [];
  }

  return [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "Missing SendGrid API key. Set SENDGRID_API_KEY or GR8_MAIL_SEND_ONLY in .env.local",
      });
    }
    sgMail.setApiKey(apiKey);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "Missing Supabase server env. Need SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const user = await getUserFromBearer(admin, req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const body = req.body || {};
    const mode = String(body.mode || "broadcast"); // "broadcast" or "test"

    const fromEmail = String(
      body.fromEmail || process.env.SENDGRID_FROM_EMAIL || user.email || ""
    ).trim();

    const fromName = String(
      body.fromName || process.env.SENDGRID_FROM_NAME || "GR8 RESULT"
    ).trim();

    const replyTo = String(body.replyTo || fromEmail).trim();

    const subject = String(body.subject || "").trim();
    const preheader = String(body.preheader || "").trim();
    const htmlRaw = String(body.html || "").trim();

    const sandbox = Boolean(body.sandbox);

    if (!fromEmail || !isEmail(fromEmail)) {
      return res.status(400).json({ success: false, error: "Invalid fromEmail" });
    }
    if (!subject) {
      return res.status(400).json({ success: false, error: "Missing subject" });
    }
    if (!htmlRaw) {
      return res.status(400).json({ success: false, error: "Missing html" });
    }

    // Optional safety guard (still allows big emails, but prevents insane sizes)
    // You can increase/remove this if you want.
    const approxBytes = Buffer.byteLength(htmlRaw, "utf8");
    const maxHtmlBytes = 18 * 1024 * 1024; // ~18MB inside our 20MB limit
    if (approxBytes > maxHtmlBytes) {
      return res.status(413).json({
        success: false,
        error:
          "Email HTML is too large. This usually happens when images are embedded as base64. Upload images to storage and reference URLs instead.",
      });
    }

    // Preheader gets injected once and used for BOTH A & B variants
    const html = injectPreheader(htmlRaw, preheader);

    // A/B
    const abEnabled = Boolean(body.abEnabled);
    const abSubjectA = String(body.abSubjectA || "").trim();
    const abSubjectB = String(body.abSubjectB || "").trim();

    if (abEnabled && (!abSubjectA || !abSubjectB)) {
      return res.status(400).json({
        success: false,
        error: "A/B enabled but Subject Line A/B missing",
      });
    }

    // Recipients
    let recipients = [];
    let audienceType = String(body.audienceType || "");
    let audience = body.audience;

    if (mode === "test") {
      const testEmail = String(body.testEmail || "").trim();
      if (!isEmail(testEmail)) {
        return res.status(400).json({ success: false, error: "Invalid testEmail" });
      }
      recipients = [testEmail];
      audienceType = "emails";
      audience = testEmail;
    } else {
      recipients = await resolveRecipients(
        admin,
        user.id,
        audienceType,
        audience,
        body.recipients
      );
      if (!recipients.length) {
        return res.status(400).json({
          success: false,
          error: "No recipients found for this audience",
        });
      }
    }

    // Broadcast record (optional)
    const broadcastId = body.broadcastId ? String(body.broadcastId) : null;
    let finalBroadcastId = broadcastId;

    if (mode !== "test") {
      try {
        const payload = {
          id: finalBroadcastId || undefined,
          user_id: user.id,
          title: String(body.form?.name || body.broadcast_title || subject || "Broadcast"),
          subject,
          preheader,
          from_email: fromEmail,
          from_name: fromName,
          reply_to: replyTo,
          html_content: htmlRaw,
          audience_type: audienceType || null,
          list_id: audienceType === "list" ? String(audience || "") : null,
          to_field: audienceType === "emails" ? String(audience || "") : null,
          ab_enabled: abEnabled,
          ab_subject_a: abEnabled ? abSubjectA : null,
          ab_subject_b: abEnabled ? abSubjectB : null,
          updated_at: new Date().toISOString(),
        };

        if (finalBroadcastId) {
          await admin
            .from("email_broadcasts")
            .update(payload)
            .eq("id", finalBroadcastId)
            .eq("user_id", user.id);
        } else {
          const { data: ins, error: insErr } = await admin
            .from("email_broadcasts")
            .insert(payload)
            .select("id")
            .single();
          if (!insErr && ins?.id) finalBroadcastId = ins.id;
        }
      } catch {
        // ignore - sending still proceeds
      }
    }

    // ✅ REAL AB SPLIT
    const shuffled = shuffle(recipients);

    let assignments = shuffled.map((email) => ({ email, variant: "A" }));
    const split = { A: shuffled.length, B: 0 };

    if (abEnabled) {
      const half = Math.ceil(shuffled.length / 2); // A gets the extra if odd
      assignments = shuffled.map((email, idx) => ({
        email,
        variant: idx < half ? "A" : "B",
      }));
      split.A = assignments.filter((x) => x.variant === "A").length;
      split.B = assignments.filter((x) => x.variant === "B").length;
    }

    const results = { sent: 0, failed: 0, errors: [] };

    for (const item of assignments) {
      const to = item.email;
      const variant = abEnabled ? item.variant : null;
      const usedSubject = abEnabled
        ? variant === "A"
          ? abSubjectA
          : abSubjectB
        : subject;

      let sendRowId = null;

      try {
        const { data: ins, error: insErr } = await admin
          .from("email_sends")
          .insert({
            user_id: user.id,
            broadcast_id: finalBroadcastId,
            email: to,
            recipient_email: to,
            email_type: mode === "test" ? "test" : "broadcast",
            status: "processing",
            ab_enabled: abEnabled,
            ab_variant: variant,
            subject: usedSubject,
            broadcast_subject: subject,
            preheader,
            from_name: fromName,
            created_at: new Date().toISOString(),
            processed_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (!insErr && ins?.id) sendRowId = ins.id;
      } catch {
        // ignore
      }

      try {
        const msg = {
          to,
          from: { email: fromEmail, name: fromName },
          replyTo: replyTo ? { email: replyTo } : undefined,
          subject: usedSubject,
          html,
          mailSettings: sandbox ? { sandboxMode: { enable: true } } : undefined,
        };

        const [resp] = await sgMail.send(msg);

        const sgId =
          resp?.headers?.["x-message-id"] ||
          resp?.headers?.["X-Message-Id"] ||
          null;

        results.sent += 1;

        if (sendRowId) {
          await admin
            .from("email_sends")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              sendgrid_message_id: sgId,
              sg_message_id: sgId,
            })
            .eq("id", sendRowId);
        }
      } catch (e) {
        results.failed += 1;
        const msg = String(
          e?.response?.body?.errors?.[0]?.message || e?.message || "SendGrid error"
        );

        results.errors.push({ email: to, error: msg });

        if (sendRowId) {
          await admin
            .from("email_sends")
            .update({
              status: "failed",
              error_message: msg,
              last_event: "failed",
              last_event_at: new Date().toISOString(),
            })
            .eq("id", sendRowId);
        }
      }
    }

    if (results.sent === 0 && results.failed > 0) {
      return res.status(500).json({
        success: false,
        error: "SendGrid did not accept any messages.",
        details: results.errors.slice(0, 5),
        ab_enabled: abEnabled,
        split,
      });
    }

    return res.status(200).json({
      success: true,
      broadcastId: finalBroadcastId,
      ab_enabled: abEnabled,
      split,
      sent: results.sent,
      failed: results.failed,
      sandbox,
      preheader_used: preheader || "",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err?.message || "Server error",
    });
  }
}
