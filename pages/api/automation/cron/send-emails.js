// /pages/api/automation/cron/send-emails.js
// FULL REPLACEMENT
//
// ✅ Sends queued emails from automation_email_queue
// ✅ DOES NOT require automation_email_queue.html column
// ✅ Gets html/subject from automation_flows.nodes JSON (email node data)
// ✅ Updates queue row to status='sent' + sent_at + sendgrid_message_id (if those columns exist)
//
// POST body: { max?: number }
// Auth: x-cron-key header OR ?key=... OR Authorization: Bearer ...

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const SERVICE_KEY =
  (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE ||
    ""
  ).trim();

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const SENDGRID_KEY =
  process.env.GR8_MAIL_SEND_ONLY || process.env.SENDGRID_API_KEY;

const DEFAULT_FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL || "no-reply@gr8result.com";
const DEFAULT_FROM_NAME =
  process.env.SENDGRID_FROM_NAME || "GR8 RESULT";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function okAuth(req) {
  const secret = CRON_SECRET;
  if (!secret) return true;
  const h = (req.headers.authorization || "").trim();
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const q = (req.query.key || "").toString().trim();
  const x = (req.headers["x-cron-key"] || "").toString().trim();
  return bearer === secret || q === secret || x === secret;
}

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function loadFlow(flow_id) {
  const { data, error } = await supabaseAdmin
    .from("automation_flows")
    .select("id,user_id,nodes,edges,name,updated_at")
    .eq("id", flow_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Flow not found");

  const nodes = safeJson(data.nodes, []);
  return { ...data, nodes: Array.isArray(nodes) ? nodes : [] };
}

function findNode(flow, nodeId) {
  return (flow.nodes || []).find((n) => String(n?.id) === String(nodeId)) || null;
}

async function loadLead(lead_id) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id,email,name,phone")
    .eq("id", lead_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Lead not found");
  return data;
}

async function sendSendGrid({ toEmail, toName, fromEmail, fromName, subject, html, templateId, dynamicData }) {
  if (!SENDGRID_KEY) throw new Error("Missing SENDGRID_API_KEY / GR8_MAIL_SEND_ONLY");
  if (!toEmail) throw new Error("Missing lead email");

  const payload = templateId
    ? {
        personalizations: [
          {
            to: [{ email: toEmail, name: toName || undefined }],
            dynamic_template_data: dynamicData || {},
          },
        ],
        from: { email: fromEmail, name: fromName },
        template_id: templateId,
      }
    : {
        personalizations: [
          { to: [{ email: toEmail, name: toName || undefined }] },
        ],
        from: { email: fromEmail, name: fromName },
        subject: subject || "Hello",
        content: [{ type: "text/html", value: html || `<p>${subject || "Hello"}</p>` }],
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

  const sgMessageId = resp.headers.get("x-message-id") || null;
  return { ok: true, sgMessageId };
}

async function updateQueueRow(id, patch) {
  // We update defensively (only columns that likely exist).
  const tryPatch = {
    ...patch,
    updated_at: nowIso(),
  };

  // attempt update; if it fails due to missing column(s), retry with smaller patch
  const { error } = await supabaseAdmin.from("automation_email_queue").update(tryPatch).eq("id", id);
  if (!error) return;

  const msg = String(error.message || "");
  // retry minimal update
  const minimal = { status: patch.status, updated_at: nowIso() };
  const { error: e2 } = await supabaseAdmin.from("automation_email_queue").update(minimal).eq("id", id);
  if (e2) throw new Error(msg);
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

    const max = Math.min(Number(req.body?.max || 100), 500);

    const { data: queued, error } = await supabaseAdmin
      .from("automation_email_queue")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(max);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    let sent = 0;
    let failed = 0;

    // cache flows per flow_id
    const flowCache = new Map();

    for (const row of queued || []) {
      try {
        const flow_id = row.flow_id;
        const lead_id = row.lead_id;
        const node_id = row.node_id;

        if (!flow_id || !lead_id || !node_id) {
          await updateQueueRow(row.id, { status: "failed", error: "Missing flow_id/lead_id/node_id" });
          failed += 1;
          continue;
        }

        let flow = flowCache.get(String(flow_id));
        if (!flow) {
          flow = await loadFlow(flow_id);
          flowCache.set(String(flow_id), flow);
        }

        const node = findNode(flow, node_id);
        if (!node) {
          await updateQueueRow(row.id, { status: "failed", error: `Node not found: ${node_id}` });
          failed += 1;
          continue;
        }

        const d = node.data || {};
        const subject = d.subject || d.title || d.label || "Hello";
        const html = d.html || d.emailHtml || d.bodyHtml || null;

        const templateId =
          d.sendgrid_template_id ||
          d.template_id ||
          d.email_template_id ||
          d.templateId ||
          null;

        const lead = await loadLead(lead_id);

        const out = await sendSendGrid({
          toEmail: lead.email,
          toName: lead.name || "",
          fromEmail: DEFAULT_FROM_EMAIL,
          fromName: DEFAULT_FROM_NAME,
          subject,
          html,
          templateId,
          dynamicData: {
            lead_name: lead.name || "",
            lead_email: lead.email || "",
            lead_phone: lead.phone || "",
            ...(d.dynamic_template_data || {}),
          },
        });

        await updateQueueRow(row.id, {
          status: "sent",
          sent_at: nowIso(),
          sendgrid_message_id: out.sgMessageId || null,
        });

        sent += 1;
      } catch (e) {
        failed += 1;
        try {
          await updateQueueRow(row.id, {
            status: "failed",
            error: String(e?.message || e).slice(0, 800),
          });
        } catch {}
      }
    }

    return res.json({
      ok: true,
      processed: queued?.length || 0,
      sent,
      failed,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
