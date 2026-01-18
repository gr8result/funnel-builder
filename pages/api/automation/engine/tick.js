// /pages/api/automation/engine/tick.js
// FULL REPLACEMENT — multi-tenant safe + DEV send blocked unless armed
// ✅ Adds SendGrid custom_args so webhook can tie events to flow/node/run
// ✅ Stores sg_message_id on the run row for debugging
//
// DEV send:
//   POST /api/automation/engine/tick?arm=YES
// PROD send:
//   POST /api/automation/engine/tick?key=CRON_SECRET

import { createClient } from "@supabase/supabase-js";
import sgMail from "@sendgrid/mail";

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

const SENDGRID_API_KEY = (process.env.SENDGRID_API_KEY || "").trim();

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const ARM_TOKEN = (process.env.AUTOMATION_SEND_ARM_TOKEN || "").trim();

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function nowIso() {
  return new Date().toISOString();
}

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function safeJson(x, fallback) {
  try {
    if (Array.isArray(x)) return x;
    if (typeof x === "string") return JSON.parse(x || "[]");
    return x ?? fallback;
  } catch {
    return fallback;
  }
}

function isProbablyHtml(s) {
  const v = String(s || "");
  return v.includes("<") && (v.includes("<html") || v.includes("<body") || v.includes("<div") || v.includes("<table") || v.includes("<!doctype"));
}

function requireProdAuth(req) {
  const q = String(req.query?.key || "").trim();
  const h1 = String(req.headers["x-cron-key"] || "").trim();
  const auth = String(req.headers.authorization || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = (m?.[1] || "").trim();

  if (q && CRON_SECRET && q === CRON_SECRET) return true;
  if (h1 && CRON_SECRET && h1 === CRON_SECRET) return true;
  if (bearer && CRON_SECRET && bearer === CRON_SECRET) return true;
  return false;
}

function devIsArmed(req) {
  const armQ = String(req.query?.arm || "").trim().toUpperCase();
  const armH = String(req.headers["x-gr8-arm"] || "").trim().toUpperCase();
  const armed = armQ === "YES" || armH === "YES";
  if (!armed) return false;

  if (ARM_TOKEN) {
    const tQ = String(req.query?.arm_token || "").trim();
    const tH = String(req.headers["x-gr8-arm-token"] || "").trim();
    return (tQ && tQ === ARM_TOKEN) || (tH && tH === ARM_TOKEN);
  }
  return true;
}

function edgeNextNodeId(edges, fromId) {
  const e = (edges || []).find((x) => String(x?.source) === String(fromId));
  return e?.target ? String(e.target) : null;
}

function findTriggerNodeId(nodes) {
  const t = (nodes || []).find((n) => String(n?.type || "").toLowerCase() === "trigger");
  return t?.id ? String(t.id) : null;
}

function findNode(nodes, nodeId) {
  return (nodes || []).find((n) => String(n?.id) === String(nodeId)) || null;
}

async function markRun(run_id, patch) {
  const { error } = await supabase
    .from("automation_flow_runs")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", run_id);

  if (error) throw error;
}

function readDelayConfig(nodeData) {
  const d = nodeData || {};
  const nested = d.delay && typeof d.delay === "object" ? d.delay : null;

  const amountRaw = nested?.amount ?? d.amount ?? d.delay_amount ?? d.value ?? 0;
  const unitRaw = nested?.unit ?? d.unit ?? d.delayUnit ?? d.delay_unit ?? "minutes";

  return { amount: Number(amountRaw || 0), unit: String(unitRaw || "minutes").toLowerCase() };
}

function delayMs(amount, unit) {
  const a = isFinite(amount) ? amount : 0;
  if (unit.startsWith("sec")) return a * 1000;
  if (unit.startsWith("min")) return a * 60 * 1000;
  if (unit.startsWith("hour")) return a * 60 * 60 * 1000;
  if (unit.startsWith("day")) return a * 24 * 60 * 60 * 1000;
  return a * 60 * 1000;
}

async function downloadHtmlFromStorage(nodeData) {
  const d = nodeData || {};
  const bucket = String(d.bucket || d.storageBucket || "email-user-assets").trim();

  const path =
    d.storagePath ||
    d.htmlPath ||
    d.filePath ||
    d.objectPath ||
    d.html_storage_path ||
    d.html_file_path ||
    null;

  if (!path) return { ok: false, html: "", reason: "no_path" };

  try {
    const { data, error } = await supabase.storage.from(bucket).download(String(path));
    if (error) return { ok: false, html: "", reason: msg(error) };

    const buf = Buffer.from(await data.arrayBuffer());
    return { ok: true, html: buf.toString("utf8") };
  } catch (e) {
    return { ok: false, html: "", reason: msg(e) };
  }
}

async function getLeadForUser(lead_id, user_id) {
  const { data, error } = await supabase
    .from("leads")
    .select("id,user_id,name,email")
    .eq("id", lead_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  if (String(data.user_id) !== String(user_id)) return { __tenant_mismatch: true, row: data };
  return data;
}

async function getFlow(flow_id) {
  const { data, error } = await supabase
    .from("automation_flows")
    .select("id,user_id,nodes,edges,name")
    .eq("id", flow_id)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getAccountSenderForUser(user_id) {
  const { data, error } = await supabase
    .from("accounts")
    .select(
      [
        "id",
        "from_email",
        "from_name",
        "default_from_email",
        "default_from_name",
        "sender_email",
        "sender_name",
        "email_from",
        "email_from_name",
        "company_name",
        "business_name",
        "name",
      ].join(",")
    )
    .eq("id", user_id)
    .maybeSingle();

  if (error || !data) return null;

  const email =
    (data.from_email ||
      data.default_from_email ||
      data.sender_email ||
      data.email_from ||
      "").trim();

  const name =
    (data.from_name ||
      data.default_from_name ||
      data.sender_name ||
      data.email_from_name ||
      data.company_name ||
      data.business_name ||
      data.name ||
      "").trim();

  if (!email) return null;
  return { email, name: name || email };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SERVICE KEY env" });
  }
  if (!SENDGRID_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing SENDGRID_API_KEY env" });
  }

  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!requireProdAuth(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized (missing/invalid cron secret)" });
    }
  }

  const armed = isProd ? true : devIsArmed(req);
  sgMail.setApiKey(SENDGRID_API_KEY);

  const debug = {
    flow_id: null,
    max: null,
    now: nowIso(),
    armed,
    picked: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    advanced: 0,
    errors: [],
    notes: [],
  };

  try {
    const flow_id = String(req.body?.flow_id || "").trim() || null;
    const max = Math.min(Math.max(Number(req.body?.max || 50), 1), 250);

    debug.flow_id = flow_id;
    debug.max = max;

    if (!flow_id) return res.status(400).json({ ok: false, error: "flow_id required", debug });

    const flow = await getFlow(flow_id);
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found", debug });

    const nodes = safeJson(flow.nodes, []);
    const edges = safeJson(flow.edges, []);

    const triggerId = findTriggerNodeId(nodes);
    if (!triggerId) return res.status(400).json({ ok: false, error: "Flow has no trigger node", debug });

    const now = new Date();

    const { data: runs, error: runErr } = await supabase
      .from("automation_flow_runs")
      .select("id,user_id,flow_id,lead_id,status,available_at,current_node_id,last_error,updated_at")
      .eq("flow_id", flow_id)
      .eq("status", "active")
      .order("updated_at", { ascending: true })
      .limit(max);

    if (runErr) throw runErr;

    const ready = (runs || []).filter((r) => {
      if (!r) return false;
      if (String(r.status) !== "active") return false;
      if (!r.available_at) return true;
      const d = new Date(r.available_at);
      return !isNaN(d.getTime()) && d.getTime() <= now.getTime();
    });

    debug.picked = ready.length;

    for (const run of ready) {
      debug.processed++;

      try {
        if (String(flow.user_id || "") !== String(run.user_id || "")) {
          await markRun(run.id, {
            status: "failed",
            last_error: `TENANT_MISMATCH: flow.user_id(${flow.user_id}) != run.user_id(${run.user_id})`,
          });
          debug.failed++;
          continue;
        }

        let currentNodeId = run.current_node_id ? String(run.current_node_id) : null;

        if (!currentNodeId) {
          const next = edgeNextNodeId(edges, triggerId);
          if (!next) {
            await markRun(run.id, { status: "done", current_node_id: triggerId, last_error: null, available_at: null });
            debug.advanced++;
            continue;
          }

          await markRun(run.id, { current_node_id: next, last_error: null, available_at: nowIso() });
          currentNodeId = next;
          debug.advanced++;
        }

        const node = findNode(nodes, currentNodeId);
        if (!node) {
          await markRun(run.id, { status: "failed", last_error: `Node not found: ${currentNodeId}` });
          debug.failed++;
          continue;
        }

        const type = String(node.type || "").toLowerCase();

        if (type === "delay") {
          const { amount, unit } = readDelayConfig(node.data || {});
          const ms = delayMs(amount, unit);
          const nextAt = new Date(Date.now() + Math.max(ms, 0)).toISOString();
          const nextNode = edgeNextNodeId(edges, currentNodeId);

          await markRun(run.id, { current_node_id: nextNode || currentNodeId, available_at: nextAt, last_error: null });

          debug.advanced++;
          debug.notes.push(`delay:${currentNodeId} amount=${amount} unit=${unit} -> ${nextAt}`);
          continue;
        }

        if (type === "condition") {
          const nextNode = edgeNextNodeId(edges, currentNodeId);
          if (!nextNode) await markRun(run.id, { status: "done", last_error: null, available_at: null });
          else {
            await markRun(run.id, { current_node_id: nextNode, available_at: nowIso(), last_error: null });
            debug.advanced++;
          }
          continue;
        }

        if (type === "email") {
          const lead = await getLeadForUser(run.lead_id, run.user_id);
          if (!lead) {
            await markRun(run.id, { status: "failed", last_error: "Lead not found" });
            debug.failed++;
            continue;
          }
          if (lead.__tenant_mismatch) {
            await markRun(run.id, {
              status: "failed",
              last_error: `TENANT_MISMATCH: lead.user_id(${lead.row?.user_id}) != run.user_id(${run.user_id})`,
            });
            debug.failed++;
            continue;
          }

          const toEmail = String(lead.email || "").trim();
          if (!toEmail) {
            await markRun(run.id, { status: "failed", last_error: "Lead has no email address" });
            debug.failed++;
            continue;
          }

          const d = node.data || {};
          const subject = String(d.subject || d.emailSubject || d.title || d.label || "Automated Email").trim();

          // sender
          let fromEmail = String(d.fromEmail || d.from_email || "").trim();
          let fromName = String(d.fromName || d.from_name || "").trim();

          if (!fromEmail) {
            const acct = await getAccountSenderForUser(run.user_id);
            fromEmail = String(acct?.email || "").trim();
            fromName = String(acct?.name || "").trim();
          }

          if (!fromEmail) {
            await markRun(run.id, {
              status: "failed",
              last_error: "NO_SENDER_CONFIG: Provide node.data.fromEmail OR set sender fields on accounts.",
            });
            debug.failed++;
            continue;
          }

          // html
          let html = "";
          if (typeof d.html === "string" && d.html.trim()) html = d.html;
          else if (typeof d.htmlContent === "string" && d.htmlContent.trim()) html = d.htmlContent;

          if (!html || !isProbablyHtml(html)) {
            const dl = await downloadHtmlFromStorage(d);
            if (dl.ok && dl.html) html = dl.html;
          }

          if (!html || !isProbablyHtml(html)) {
            await markRun(run.id, {
              status: "failed",
              last_error:
                "EMAIL_HTML_MISSING: expected node.data.html/htmlContent OR htmlPath/storagePath/etc.",
            });
            debug.failed++;
            continue;
          }

          if (!armed) {
            await markRun(run.id, { status: "failed", last_error: "DEV_SEND_BLOCKED: Not armed (?arm=YES)" });
            debug.failed++;
            continue;
          }

          // ✅ IMPORTANT: correlation ids
          const emailId = String(d.emailId || d.email_id || "").trim() || null;

          // send
          let sgMessageId = null;
          try {
            const [resp] = await sgMail.send({
              to: toEmail,
              from: { email: fromEmail, name: fromName || fromEmail },
              subject,
              html,
              // ✅ This is what your webhook reads as ev.custom_args
              customArgs: {
                provider: "sendgrid",
                flow_id: String(flow_id),
                node_id: String(currentNodeId),
                run_id: String(run.id),
                user_id: String(run.user_id),
                lead_id: String(run.lead_id),
                email_id: emailId || "",
              },
            });

            // best-effort message id
            sgMessageId = resp?.headers?.["x-message-id"] || resp?.headers?.["X-Message-Id"] || null;

            debug.sent++;
            debug.notes.push(`sent:${run.id} node=${currentNodeId} -> ${toEmail} from=${fromEmail}`);
          } catch (e) {
            await markRun(run.id, { status: "failed", last_error: `SendGrid send failed: ${msg(e)}` });
            debug.failed++;
            continue;
          }

          // store sg id (optional but VERY useful)
          try {
            await markRun(run.id, { last_error: null, sendgrid_message_id: sgMessageId });
          } catch {}

          // advance
          const nextNode = edgeNextNodeId(edges, currentNodeId);
          if (!nextNode) {
            await markRun(run.id, { status: "done", available_at: null, last_error: null });
          } else {
            await markRun(run.id, { current_node_id: nextNode, available_at: nowIso(), last_error: null });
            debug.advanced++;
          }
          continue;
        }

        // default: advance
        {
          const nextNode = edgeNextNodeId(edges, currentNodeId);
          if (!nextNode) await markRun(run.id, { status: "done", available_at: null, last_error: null });
          else {
            await markRun(run.id, { current_node_id: nextNode, available_at: nowIso(), last_error: null });
            debug.advanced++;
          }
        }
      } catch (e) {
        debug.errors.push(msg(e));
        try {
          await markRun(run.id, { status: "failed", last_error: msg(e) });
        } catch {}
        debug.failed++;
      }
    }

    return res.json({ ok: true, debug });
  } catch (e) {
    debug.errors.push(msg(e));
    return res.status(500).json({ ok: false, error: msg(e), debug });
  }
}
