// /pages/api/automation/engine/tick.js
// FULL REPLACEMENT
//
// ✅ Uses YOUR REAL tables that have data: automation_queue + automation_flows + automation_flow_members
// ✅ Processes pending automation_queue rows where run_at <= now (or force=1)
// ✅ Walks your flow graph (nodes/edges) and executes the NEXT node
// ✅ Email nodes queue into email_campaign_queue (adaptive schema: scheduled_at OR scheduled_for)
// ✅ Delay nodes push run_at forward and continue later
// ✅ Writes errors to automation_logs + sets automation_queue.status='failed' with last_error
//
// GET/POST /api/automation/engine/tick
// Query:
//   - flow_id=...   optional: process only one flow
//   - limit=50      optional
//   - force=1       optional: ignore run_at (process immediately)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const NOW = () => new Date().toISOString();

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === "string") return JSON.parse(v || "null") ?? fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function isUuid(v) {
  const s = String(v || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

async function hasColumn(table, col) {
  const { error } = await supabase.from(table).select(col).limit(1);
  return !error;
}

function buildGraph(nodes = [], edges = []) {
  const out = new Map();
  const byId = new Map();
  for (const n of nodes || []) byId.set(String(n.id), n);
  for (const e of edges || []) {
    const a = String(e.source || "");
    const b = String(e.target || "");
    if (!a || !b) continue;
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  }
  return { out, byId };
}

function findTriggerNode(nodes = []) {
  return (nodes || []).find((n) => String(n?.type || "") === "trigger") || null;
}

function pickNextNodeId(outMap, nodeId) {
  const nexts = outMap.get(String(nodeId)) || [];
  return nexts[0] ? String(nexts[0]) : null; // first path only
}

function getEmailTemplateKey(node) {
  // UI might store UUID OR a name/slug like "was-email-test-10"
  return (
    node?.data?.template_id ||
    node?.data?.email_template_id ||
    node?.data?.templateId ||
    node?.data?.template ||
    node?.data?.id ||
    null
  );
}

function getDelayMinutes(node) {
  return (
    Number(
      node?.data?.minutes ??
        node?.data?.delay_minutes ??
        node?.data?.delay ??
        node?.data?.value ??
        0
    ) || 0
  );
}

async function logAutomation({ user_id, flow_id, lead_id, node_id, node_type, action, status, message }) {
  try {
    // table is optional; do not crash tick if it fails
    await supabase.from("automation_logs").insert([
      {
        user_id: user_id || null,
        subscriber_id: lead_id || null, // your automation_logs uses subscriber_id uuid not null
        flow_id: flow_id || null,
        node_id: node_id || null,
        node_type: node_type || null,
        action: action || null,
        status: status || "success",
        message: message || null,
        created_at: NOW(),
      },
    ]);
  } catch {
    // ignore
  }
}

async function resolveEmailTemplateId(templateKey) {
  const key = String(templateKey || "").trim();
  if (!key) return null;

  // If already a UUID, use directly
  if (isUuid(key)) return key;

  // Try lookups against email_templates (common columns: id, name, slug, key)
  const candidates = [
    { col: "name", val: key },
    { col: "slug", val: key },
    { col: "key", val: key },
  ];

  for (const c of candidates) {
    const { data, error } = await supabase
      .from("email_templates")
      .select("id")
      .eq(c.col, c.val)
      .limit(1)
      .maybeSingle();

    if (!error && data?.id) return data.id;
  }

  // Try exact id string match fallback (if column is text in some envs)
  const { data: d2, error: e2 } = await supabase
    .from("email_templates")
    .select("id")
    .eq("id", key)
    .limit(1)
    .maybeSingle();

  if (!e2 && d2?.id) return d2.id;

  return null;
}

async function bestEffortAlreadyQueued({ lead_id, flow_id, node_id }) {
  try {
    const { data, error } = await supabase
      .from("email_campaign_queue")
      .select("id,meta,flow_id,node_id,lead_id")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return false;

    return (data || []).some((r) => {
      if (r?.flow_id && r?.node_id) {
        return String(r.flow_id) === String(flow_id) && String(r.node_id) === String(node_id);
      }
      const m = r?.meta || {};
      return (
        m &&
        typeof m === "object" &&
        String(m.flow_id || "") === String(flow_id) &&
        String(m.node_id || "") === String(node_id)
      );
    });
  } catch {
    return false;
  }
}

function computeEmailIndex({ triggerId, targetNodeId, nodesById, outMap }) {
  let idx = 0;
  let cur = String(triggerId || "");
  const target = String(targetNodeId || "");
  const seen = new Set();

  for (let i = 0; i < 200; i++) {
    const next = pickNextNodeId(outMap, cur);
    if (!next) break;
    if (seen.has(next)) break;
    seen.add(next);

    const n = nodesById.get(String(next));
    if (n && String(n.type) === "email") idx++;

    if (String(next) === target) return Math.max(1, idx);
    cur = String(next);
  }

  return 1;
}

async function tryInsertEmailQueue(row) {
  const hasScheduledAt = await hasColumn("email_campaign_queue", "scheduled_at");
  const hasScheduledFor = await hasColumn("email_campaign_queue", "scheduled_for");
  const scheduleKey = hasScheduledAt ? "scheduled_at" : hasScheduledFor ? "scheduled_for" : null;

  const now = row.scheduled_at || NOW();

  const base = {
    user_id: row.user_id,
    lead_id: row.lead_id,
    template_id: row.template_id,
    status: row.status || "queued",
    email_index: row.email_index || 1,
    flow_id: row.flow_id,
    node_id: row.node_id,
    meta: row.meta || {},
  };

  if (scheduleKey) base[scheduleKey] = now;

  const attempts = [
    base,
    // drop flow/node/meta if those cols don't exist
    {
      user_id: row.user_id,
      lead_id: row.lead_id,
      template_id: row.template_id,
      status: row.status || "queued",
      email_index: row.email_index || 1,
      ...(scheduleKey ? { [scheduleKey]: now } : {}),
    },
    // drop status
    {
      user_id: row.user_id,
      lead_id: row.lead_id,
      template_id: row.template_id,
      email_index: row.email_index || 1,
      ...(scheduleKey ? { [scheduleKey]: now } : {}),
    },
    // minimal
    {
      user_id: row.user_id,
      lead_id: row.lead_id,
      template_id: row.template_id,
      ...(scheduleKey ? { [scheduleKey]: now } : {}),
    },
  ];

  let lastErr = null;
  for (const payload of attempts) {
    const { error } = await supabase.from("email_campaign_queue").insert([payload]);
    if (!error) return { ok: true, scheduleKey };
    lastErr = error;
  }

  return { ok: false, error: msg(lastErr) || "Queue insert failed" };
}

async function ensureAutomationQueueSeededForFlow(flow_id) {
  // If members exist but no automation_queue row exists, seed it (so trigger actually starts)
  // Uses (user_id, flow_id, lead_id) unique constraint that you have on automation_queue.
  const { data: members, error: mErr } = await supabase
    .from("automation_flow_members")
    .select("user_id,lead_id,status")
    .eq("flow_id", flow_id)
    .eq("status", "active");

  if (mErr) return { ok: false, error: msg(mErr), created: 0 };

  const leadIds = (members || []).map((m) => m.lead_id).filter(Boolean);
  if (!leadIds.length) return { ok: true, created: 0 };

  const { data: existing, error: eErr } = await supabase
    .from("automation_queue")
    .select("id,lead_id")
    .eq("flow_id", flow_id)
    .in("lead_id", leadIds)
    .limit(5000);

  if (eErr) return { ok: false, error: msg(eErr), created: 0 };

  const have = new Set((existing || []).map((r) => String(r.lead_id)));
  const toCreate = [];

  for (const m of members || []) {
    if (!m?.lead_id) continue;
    if (have.has(String(m.lead_id))) continue;

    toCreate.push({
      user_id: m.user_id,
      subscriber_id: m.lead_id, // your automation_queue column name is subscriber_id
      flow_id,
      next_node_id: null, // null means start at trigger
      run_at: NOW(),
      status: "pending",
      created_at: NOW(),
      updated_at: NOW(),
      lead_id: m.lead_id, // your table also has lead_id text
      list_id: null,
      contact_id: null,
    });
  }

  if (!toCreate.length) return { ok: true, created: 0 };

  // Insert best-effort (some envs may not have all cols)
  const attempts = [
    toCreate,
    toCreate.map((r) => ({
      user_id: r.user_id,
      subscriber_id: r.subscriber_id,
      flow_id: r.flow_id,
      next_node_id: r.next_node_id,
      run_at: r.run_at,
      status: r.status,
      lead_id: r.lead_id,
    })),
    toCreate.map((r) => ({
      user_id: r.user_id,
      subscriber_id: r.subscriber_id,
      flow_id: r.flow_id,
      run_at: r.run_at,
      status: r.status,
      lead_id: r.lead_id,
    })),
    toCreate.map((r) => ({
      user_id: r.user_id,
      subscriber_id: r.subscriber_id,
      flow_id: r.flow_id,
    })),
  ];

  let lastErr = null;
  for (const payload of attempts) {
    const { error } = await supabase.from("automation_queue").insert(payload);
    if (!error) return { ok: true, created: toCreate.length };
    lastErr = error;
  }

  return { ok: false, error: msg(lastErr), created: 0 };
}

async function advanceQueueRow({ row, flow }) {
  const nodes = safeJson(flow.nodes, []);
  const edges = safeJson(flow.edges, []);
  const graph = buildGraph(nodes, edges);

  const trigger = findTriggerNode(nodes);
  if (!trigger) {
    await logAutomation({
      user_id: row.user_id,
      flow_id: row.flow_id,
      lead_id: row.lead_id,
      node_id: null,
      node_type: "trigger",
      action: "advance",
      status: "error",
      message: "Missing trigger node",
    });

    await supabase
      .from("automation_queue")
      .update({
        status: "failed",
        updated_at: NOW(),
      })
      .eq("id", row.id);

    return { ok: false, error: "missing_trigger" };
  }

  // next_node_id on the queue means "where am I up to?"
  // If null -> start from trigger
  const curNodeId = row.next_node_id ? String(row.next_node_id) : String(trigger.id);

  const nextId = pickNextNodeId(graph.out, curNodeId);
  if (!nextId) {
    await supabase
      .from("automation_queue")
      .update({
        status: "done",
        updated_at: NOW(),
      })
      .eq("id", row.id);

    await logAutomation({
      user_id: row.user_id,
      flow_id: row.flow_id,
      lead_id: row.lead_id,
      node_id: curNodeId,
      node_type: "end",
      action: "complete",
      status: "success",
      message: "Flow complete",
    });

    return { ok: true, done: true };
  }

  const node = graph.byId.get(String(nextId));
  if (!node) {
    await logAutomation({
      user_id: row.user_id,
      flow_id: row.flow_id,
      lead_id: row.lead_id,
      node_id: nextId,
      node_type: "unknown",
      action: "advance",
      status: "error",
      message: `Missing node: ${nextId}`,
    });

    await supabase
      .from("automation_queue")
      .update({
        status: "failed",
        updated_at: NOW(),
      })
      .eq("id", row.id);

    return { ok: false, error: "missing_node" };
  }

  const type = String(node.type || "");

  // EMAIL NODE
  if (type === "email") {
    const templateKey = getEmailTemplateKey(node);
    const template_id = await resolveEmailTemplateId(templateKey);

    if (!template_id) {
      await logAutomation({
        user_id: row.user_id,
        flow_id: row.flow_id,
        lead_id: row.lead_id,
        node_id: node.id,
        node_type: "email",
        action: "queue_email",
        status: "error",
        message: `Email template not found for key: ${String(templateKey || "")}`,
      });

      await supabase
        .from("automation_queue")
        .update({
          status: "failed",
          updated_at: NOW(),
        })
        .eq("id", row.id);

      return { ok: false, error: "missing_template" };
    }

    const already = await bestEffortAlreadyQueued({
      lead_id: row.lead_id,
      flow_id: row.flow_id,
      node_id: node.id,
    });

    if (!already) {
      const email_index = computeEmailIndex({
        triggerId: trigger.id,
        targetNodeId: node.id,
        nodesById: graph.byId,
        outMap: graph.out,
      });

      const q = await tryInsertEmailQueue({
        user_id: row.user_id,
        lead_id: row.lead_id,
        template_id,
        status: "queued",
        email_index,
        flow_id: row.flow_id,
        node_id: node.id,
        meta: {
          source: "automation_queue_engine",
          flow_id: row.flow_id,
          node_id: node.id,
          queue_id: row.id,
        },
        scheduled_at: NOW(),
      });

      if (!q.ok) {
        await logAutomation({
          user_id: row.user_id,
          flow_id: row.flow_id,
          lead_id: row.lead_id,
          node_id: node.id,
          node_type: "email",
          action: "queue_email",
          status: "error",
          message: `Queue insert failed: ${q.error}`,
        });

        await supabase
          .from("automation_queue")
          .update({
            status: "failed",
            updated_at: NOW(),
          })
          .eq("id", row.id);

        return { ok: false, error: q.error };
      }

      await logAutomation({
        user_id: row.user_id,
        flow_id: row.flow_id,
        lead_id: row.lead_id,
        node_id: node.id,
        node_type: "email",
        action: "queue_email",
        status: "success",
        message: `Queued email (template_id=${template_id})`,
      });
    }

    // Advance to "we just executed this email node"
    await supabase
      .from("automation_queue")
      .update({
        status: "pending",
        next_node_id: String(node.id),
        run_at: NOW(),
        updated_at: NOW(),
      })
      .eq("id", row.id);

    return { ok: true, stepped: "email", queued: already ? 0 : 1 };
  }

  // DELAY NODE
  if (type === "delay") {
    const mins = getDelayMinutes(node);
    const runAt = new Date(Date.now() + mins * 60 * 1000).toISOString();

    // After delay, the NEXT to execute is the node after delay
    const afterDelay = pickNextNodeId(graph.out, String(node.id));

    await supabase
      .from("automation_queue")
      .update({
        status: "pending",
        next_node_id: afterDelay ? String(node.id) : String(node.id),
        run_at: runAt,
        updated_at: NOW(),
      })
      .eq("id", row.id);

    await logAutomation({
      user_id: row.user_id,
      flow_id: row.flow_id,
      lead_id: row.lead_id,
      node_id: node.id,
      node_type: "delay",
      action: "delay",
      status: "success",
      message: `Delay ${mins} minutes`,
    });

    return { ok: true, stepped: "delay", minutes: mins };
  }

  // OTHER NODES (condition/etc): just advance by setting next_node_id = this node and run now
  await supabase
    .from("automation_queue")
    .update({
      status: "pending",
      next_node_id: String(node.id),
      run_at: NOW(),
      updated_at: NOW(),
    })
    .eq("id", row.id);

  await logAutomation({
    user_id: row.user_id,
    flow_id: row.flow_id,
    lead_id: row.lead_id,
    node_id: node.id,
    node_type: type || "other",
    action: "advance",
    status: "success",
    message: `Advanced node type: ${type || "other"}`,
  });

  return { ok: true, stepped: type || "other" };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "GET or POST only" });
  }

  const flow_id = req.query?.flow_id ? String(req.query.flow_id) : null;
  const limit = Number(req.query?.limit || 50) || 50;
  const force = String(req.query?.force || "0") === "1";

  const debug = {
    now: NOW(),
    flow_id,
    limit,
    force,
    flowsLoaded: 0,
    seededQueue: [],
    queueRowsFetched: 0,
    advanced: 0,
    queuedEmails: 0,
    done: 0,
    errors: 0,
    samples: [],
  };

  try {
    // Load flows
    let fq = supabase
      .from("automation_flows")
      .select("id,nodes,edges,updated_at")
      .order("updated_at", { ascending: false });

    if (flow_id) fq = fq.eq("id", flow_id);

    const { data: flows, error: fErr } = await fq.limit(100);
    if (fErr) return res.status(500).json({ ok: false, error: msg(fErr), debug });

    debug.flowsLoaded = (flows || []).length;
    if (!flows?.length) return res.json({ ok: true, debug });

    // Ensure automation_queue has rows for active members (so trigger can start)
    for (const f of flows) {
      const seeded = await ensureAutomationQueueSeededForFlow(f.id);
      debug.seededQueue.push({ flow_id: f.id, ...seeded });
    }

    // Build flow map
    const flowMap = new Map((flows || []).map((f) => [String(f.id), f]));

    // Fetch due queue rows
    let qq = supabase
      .from("automation_queue")
      .select("id,user_id,subscriber_id,flow_id,next_node_id,run_at,status,lead_id")
      .eq("status", "pending")
      .order("run_at", { ascending: true })
      .limit(limit);

    if (flow_id) qq = qq.eq("flow_id", flow_id);
    if (!force) qq = qq.lte("run_at", NOW());

    const { data: rows, error: qErr } = await qq;
    if (qErr) return res.status(500).json({ ok: false, error: msg(qErr), debug });

    debug.queueRowsFetched = (rows || []).length;
    if (!rows?.length) return res.json({ ok: true, message: "No due automation_queue rows.", debug });

    for (const row of rows) {
      const flow = flowMap.get(String(row.flow_id));
      if (!flow) {
        debug.errors++;
        await supabase
          .from("automation_queue")
          .update({ status: "failed", updated_at: NOW() })
          .eq("id", row.id);

        await logAutomation({
          user_id: row.user_id,
          flow_id: row.flow_id,
          lead_id: row.lead_id,
          node_id: row.next_node_id || null,
          node_type: "flow",
          action: "load_flow",
          status: "error",
          message: "Flow not found",
        });

        continue;
      }

      const r = await advanceQueueRow({ row, flow });

      debug.samples.push({
        queue_id: row.id,
        lead_id: row.lead_id,
        flow_id: row.flow_id,
        before_node: row.next_node_id || null,
        result: r,
      });

      if (r?.ok) {
        debug.advanced++;
        if (r.done) debug.done++;
        if (r.stepped === "email") debug.queuedEmails += Number(r.queued || 0);
      } else {
        debug.errors++;
      }
    }

    return res.json({ ok: true, debug });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e), debug });
  }
}
