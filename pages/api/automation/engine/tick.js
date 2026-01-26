// /pages/api/automation/engine/tick.js
// FULL REPLACEMENT — fixes TENANT_MISMATCH and makes runs use lead.user_id (source of truth)
//
// ✅ Auth via:
//    - Authorization: Bearer <secret>
//    - OR query param: ?key=<secret>
//    - OR header: x-cron-key: <secret>
//
// ✅ NEVER fails just because run.user_id is wrong — repairs it to lead.user_id
// ✅ Sends emails for "email" nodes (HTML in Supabase Storage)
// ✅ Works whether nodes/edges stored as JSON string or object
// ✅ Does not touch Broadcasts/Campaigns modules
//
// ENV required:
//  - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE)
//  - SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)
//  - AUTOMATION_CRON_SECRET (or AUTOMATION_CRON_KEY / CRON_SECRET)
// Optional:
//  - DEFAULT_FROM_EMAIL
//  - DEFAULT_FROM_NAME

import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

function getSendGridKey() {
  return (process.env.SENDGRID_API_KEY || process.env.GR8_MAIL_SEND_ONLY || "").trim();
}

function okAuth(req) {
  const h = (req.headers.authorization || "").trim();
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const q = (req.query.key || "").toString().trim();
  const x = (req.headers["x-cron-key"] || "").toString().trim();
  const secret = CRON_SECRET;
  if (!secret) return true; // dev-safe: if no secret set, allow
  return bearer === secret || q === secret || x === secret;
}

function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function loadHtmlFromStorage(supabase, bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`STORAGE_DOWNLOAD_FAILED: ${error?.message || "no data"}`);
  return await data.text();
}

function findStartNodeId(nodes, edges) {
  // prefer explicit trigger node
  const trigger = (nodes || []).find((n) => (n?.type || "").toLowerCase().includes("trigger"));
  if (trigger?.id) return trigger.id;

  // fallback: first node with no incoming edges
  const incoming = new Set((edges || []).map((e) => e.target));
  const first = (nodes || []).find((n) => !incoming.has(n.id));
  return first?.id || (nodes?.[0]?.id ?? null);
}

function nextFrom(nodeId, edges) {
  const e = (edges || []).find((x) => x.source === nodeId);
  return e?.target || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!okAuth(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const flow_id = (req.body?.flow_id || req.query.flow_id || "").toString().trim();
  const max = Math.min(parseInt(req.body?.max || req.query.max || "50", 10) || 50, 200);
  const armed = (req.query.arm || req.body?.arm || "").toString().toLowerCase() === "yes";

  const debug = {
    flow_id,
    max,
    now: new Date().toISOString(),
    armed,
    members_seen: 0,
    runs_created: 0,
    picked: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    advanced: 0,
    errors: [],
    notes: [],
  };

  try {
    if (!flow_id) {
      return res.status(400).json({ ok: false, error: "Missing flow_id", debug });
    }

    const sgKey = getSendGridKey();
    if (!sgKey) {
      return res.status(500).json({ ok: false, error: "Missing SendGrid API key", debug });
    }
    sgMail.setApiKey(sgKey);

    // Load flow
    const { data: flow, error: flowErr } = await supabase
      .from("automation_flows")
      .select("id, nodes, edges, name")
      .eq("id", flow_id)
      .single();

    if (flowErr || !flow) {
      return res.status(404).json({ ok: false, error: flowErr?.message || "Flow not found", debug });
    }

    const nodes = safeJson(flow.nodes, []);
    const edges = safeJson(flow.edges, []);
    const startNodeId = findStartNodeId(nodes, edges);
    if (!startNodeId) {
      return res.status(500).json({ ok: false, error: "Flow has no start node", debug });
    }

    // Members for this flow (these are the leads you WANT to process)
    const { data: members, error: memErr } = await supabase
      .from("automation_flow_members")
      .select("id, lead_id, flow_id")
      .eq("flow_id", flow_id)
      .limit(max);

    if (memErr) throw new Error(`MEMBERS_LOAD_FAILED: ${memErr.message}`);
    debug.members_seen = members?.length || 0;

    // Ensure a run exists per member (without creating wrong user_id)
    for (const m of members || []) {
      if (!m.lead_id) continue;

      // get lead owner
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("id, user_id, email")
        .eq("id", m.lead_id)
        .single();

      if (leadErr || !lead?.user_id) {
        debug.errors.push(`LEAD_LOAD_FAILED ${m.lead_id}: ${leadErr?.message || "no lead/user_id"}`);
        continue;
      }

      // run already?
      const { data: existing } = await supabase
        .from("automation_flow_runs")
        .select("id, user_id")
        .eq("flow_id", flow_id)
        .eq("lead_id", m.lead_id)
        .maybeSingle();

      if (!existing) {
        const { error: insErr } = await supabase.from("automation_flow_runs").insert({
          flow_id,
          lead_id: m.lead_id,
          user_id: lead.user_id, // ✅ SOURCE OF TRUTH
          status: "pending",
          current_node: startNodeId,
          available_at: new Date().toISOString(),
          last_error: null,
        });

        if (insErr) debug.errors.push(`RUN_CREATE_FAILED ${m.lead_id}: ${insErr.message}`);
        else debug.runs_created += 1;
      } else if (existing.user_id !== lead.user_id) {
        // ✅ Repair wrong user_id instead of failing forever
        const { error: upErr } = await supabase
          .from("automation_flow_runs")
          .update({ user_id: lead.user_id, last_error: null })
          .eq("id", existing.id);

        if (upErr) debug.errors.push(`RUN_REPAIR_FAILED ${m.lead_id}: ${upErr.message}`);
        else debug.notes.push(`Repaired run.user_id for lead ${m.lead_id}`);
      }
    }

    // Pick runs ready to process
    const { data: runs, error: runErr } = await supabase
      .from("automation_flow_runs")
      .select("id, lead_id, user_id, current_node, available_at, status")
      .eq("flow_id", flow_id)
      .eq("status", "pending")
      .lte("available_at", new Date().toISOString())
      .limit(max);

    if (runErr) throw new Error(`RUNS_LOAD_FAILED: ${runErr.message}`);
    debug.picked = runs?.length || 0;

    for (const r of runs || []) {
      debug.processed += 1;

      // Always load lead owner and enforce consistency
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("id, user_id, email, name")
        .eq("id", r.lead_id)
        .single();

      if (leadErr || !lead?.email) {
        debug.failed += 1;
        await supabase.from("automation_flow_runs").update({
          status: "failed",
          last_error: `LEAD_LOAD_FAILED: ${leadErr?.message || "missing email"}`,
        }).eq("id", r.id);
        continue;
      }

      if (lead.user_id !== r.user_id) {
        // repair + continue (don’t fail the flow)
        await supabase.from("automation_flow_runs").update({
          user_id: lead.user_id,
          last_error: null,
        }).eq("id", r.id);
      }

      const node = (nodes || []).find((n) => n.id === r.current_node);
      if (!node) {
        debug.failed += 1;
        await supabase.from("automation_flow_runs").update({
          status: "failed",
          last_error: "NODE_NOT_FOUND",
        }).eq("id", r.id);
        continue;
      }

      const nodeType = (node.type || "").toLowerCase();
      const nodeData = node.data || {};

      try {
        if (nodeType.includes("email")) {
          // nodeData should contain bucket/path or a reference
          const bucket = (nodeData.bucket || nodeData.storage_bucket || "email-user-assets").toString();
          const path =
            (nodeData.html_path ||
              nodeData.storage_path ||
              nodeData.path ||
              "").toString();

          if (!path) throw new Error("EMAIL_NODE_MISSING_HTML_PATH");

          const html = await loadHtmlFromStorage(supabase, bucket, path);

          // From identity — keep it simple + safe (don’t depend on accounts.company_name etc.)
          const fromEmail =
            (process.env.DEFAULT_FROM_EMAIL || "").trim() || "no-reply@gr8result.com";
          const fromName =
            (process.env.DEFAULT_FROM_NAME || "").trim() || "GR8 RESULT";

          const subject = (nodeData.subject || "Check-in").toString();

          await sgMail.send({
            to: lead.email,
            from: { email: fromEmail, name: fromName },
            subject,
            html,
          });

          debug.sent += 1;

          // Advance to next node
          const next = nextFrom(r.current_node, edges);
          if (!next) {
            await supabase.from("automation_flow_runs").update({
              status: "done",
              current_node: null,
              last_error: null,
            }).eq("id", r.id);
          } else {
            await supabase.from("automation_flow_runs").update({
              status: "pending",
              current_node: next,
              available_at: new Date().toISOString(),
              last_error: null,
            }).eq("id", r.id);
            debug.advanced += 1;
          }
        } else if (nodeType.includes("delay")) {
          // delay node: wait N minutes then advance
          const minutes = parseInt(nodeData.minutes || nodeData.delay_minutes || "1", 10) || 1;
          const when = new Date(Date.now() + minutes * 60 * 1000).toISOString();
          const next = nextFrom(r.current_node, edges);

          await supabase.from("automation_flow_runs").update({
            status: next ? "pending" : "done",
            current_node: next,
            available_at: when,
            last_error: null,
          }).eq("id", r.id);

          debug.advanced += 1;
        } else {
          // unknown node: just advance
          const next = nextFrom(r.current_node, edges);
          await supabase.from("automation_flow_runs").update({
            status: next ? "pending" : "done",
            current_node: next,
            available_at: new Date().toISOString(),
            last_error: null,
          }).eq("id", r.id);
          debug.advanced += 1;
        }
      } catch (e) {
        debug.failed += 1;
        await supabase.from("automation_flow_runs").update({
          status: "failed",
          last_error: String(e?.message || e),
        }).eq("id", r.id);
      }
    }

    return res.status(200).json({ ok: true, debug });
  } catch (e) {
    debug.errors.push(String(e?.message || e));
    return res.status(500).json({ ok: false, error: String(e?.message || e), debug });
  }
}
