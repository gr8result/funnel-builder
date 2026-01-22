// /pages/api/automation/engine/start.js
// FULL REPLACEMENT
//
// ✅ Creates automation_flow_runs for members already in a flow
// ✅ Sets run.user_id = leads.user_id (AUTH UID) (NOT NULL)
// ✅ Writes current node into either current_node_id OR current_node (auto-fallback)
// ✅ Ownership-safe (automation_flows.user_id is accounts.id)
//
// POST JSON:
//  { flow_id: "uuid" }                      -> starts everyone in the flow
//  { flow_id: "uuid", lead_id: "uuid" }     -> starts only that lead
//
// Requires env:
//  NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  SUPABASE_SERVICE_ROLE_KEY (or variants)
//  NEXT_PUBLIC_SUPABASE_ANON_KEY

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

const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function nowIso() {
  return new Date().toISOString();
}

function getBearer(req) {
  const auth = String(req.headers.authorization || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
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

function findStartNodeId(nodes, edges) {
  const trig = (nodes || []).find((n) => (n?.type || "").toLowerCase() === "trigger");
  if (trig?.id) return trig.id;

  const incoming = new Set((edges || []).map((e) => e?.target).filter(Boolean));
  const first = (nodes || []).find((n) => n?.id && !incoming.has(n.id));
  return first?.id || (nodes?.[0]?.id ?? null);
}

async function getAccountIdForUser(admin, auth_uid) {
  if (!auth_uid) return null;
  const { data, error } = await admin
    .from("accounts")
    .select("id")
    .eq("user_id", auth_uid)
    .maybeSingle();
  if (error) return null;
  return data?.id || null;
}

// try upsert with the correct current-node column name
async function upsertRunWithFallback(admin, baseRow, startNodeId) {
  const now = nowIso();

  const variants = [
    { ...baseRow, current_node_id: startNodeId, updated_at: now, created_at: now }, // ✅ preferred
    { ...baseRow, current_node: startNodeId, updated_at: now, created_at: now }, // fallback
  ];

  // prefer upsert on (flow_id,lead_id) if you have it; else fallback insert
  for (const row of variants) {
    // Upsert attempt
    const { error: upErr } = await admin
      .from("automation_flow_runs")
      .upsert([row], { onConflict: "flow_id,lead_id" });

    if (!upErr) return { ok: true, mode: "upsert" };

    const m = msg(upErr).toLowerCase();
    const maybeNoConstraint =
      m.includes("no unique") ||
      m.includes("no exclusion constraint") ||
      m.includes("on conflict");

    // If it failed because the COLUMN doesn't exist, try next variant
    if (m.includes("column") && m.includes("does not exist")) continue;

    // If it failed because onConflict isn't supported, try insert with this row
    if (maybeNoConstraint) {
      const { error: insErr } = await admin.from("automation_flow_runs").insert([row]);
      if (!insErr) return { ok: true, mode: "insert" };

      const mm = msg(insErr).toLowerCase();
      if (mm.includes("column") && mm.includes("does not exist")) continue;
      if (mm.includes("duplicate") || mm.includes("unique")) return { ok: true, mode: "already" };
      throw insErr;
    }

    // Anything else = real error
    throw upErr;
  }

  throw new Error("Could not write run: neither current_node_id nor current_node exists.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing env",
      need: [
        "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)",
        "SUPABASE_SERVICE_ROLE_KEY (or variants)",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ],
    });
  }

  const token = getBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userErr,
  } = await authed.auth.getUser();

  if (userErr || !user?.id) {
    return res.status(401).json({ ok: false, error: "Invalid session", detail: msg(userErr) });
  }

  const flow_id = String(req.body?.flow_id || "").trim();
  const only_lead_id = String(req.body?.lead_id || "").trim();

  if (!flow_id) return res.status(400).json({ ok: false, error: "flow_id required" });

  const debug = {
    flow_id,
    auth_uid: user.id,
    account_id: null,
    start_node_id: null,
    members_targeted: 0,
    runs_written: 0,
    runs_already: 0,
    errors: [],
  };

  try {
    const account_id = await getAccountIdForUser(admin, user.id);
    debug.account_id = account_id;

    const { data: flow, error: flowErr } = await admin
      .from("automation_flows")
      .select("id,user_id,account_id,is_standard,nodes,edges")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr) throw flowErr;
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found", debug });

    const flowOwner = flow.account_id || flow.user_id || null;
    const owned =
      flow.is_standard === true ||
      (account_id && String(flowOwner) === String(account_id)) ||
      String(flowOwner) === String(user.id); // legacy tolerance

    if (!owned) {
      return res.status(403).json({
        ok: false,
        error: "Not allowed for this flow",
        debug: { ...debug, flow_owner: flowOwner },
      });
    }

    const nodes = safeJson(flow.nodes, []);
    const edges = safeJson(flow.edges, []);
    const start_node_id = findStartNodeId(nodes, edges);
    debug.start_node_id = start_node_id;

    if (!start_node_id) {
      return res.status(500).json({ ok: false, error: "Flow has no start node", debug });
    }

    // Active members
    let memQ = admin
      .from("automation_flow_members")
      .select("lead_id")
      .eq("flow_id", flow_id)
      .eq("status", "active")
      .limit(10000);

    if (only_lead_id) memQ = memQ.eq("lead_id", only_lead_id);

    const { data: mem, error: memErr } = await memQ;
    if (memErr) throw memErr;

    const leadIds = (mem || []).map((r) => r.lead_id).filter(Boolean);
    debug.members_targeted = leadIds.length;

    if (!leadIds.length) {
      return res.json({ ok: true, debug, note: "No active members found in this flow yet." });
    }

    // Need leads.user_id for run.user_id
    const { data: leads, error: leadsErr } = await admin
      .from("leads")
      .select("id,user_id,email")
      .in("id", leadIds);

    if (leadsErr) throw leadsErr;

    const leadMap = new Map((leads || []).map((l) => [l.id, l]));

    for (const lead_id of leadIds) {
      const lead = leadMap.get(lead_id);
      const lead_user_id = lead?.user_id;

      if (!lead_user_id) {
        debug.errors.push(`Lead ${lead_id} missing user_id`);
        continue;
      }

      const baseRow = {
        user_id: lead_user_id,
        flow_id,
        lead_id,
        status: "pending",
        available_at: nowIso(),
        last_error: null,
      };

      const out = await upsertRunWithFallback(admin, baseRow, start_node_id);
      if (out.mode === "already") debug.runs_already += 1;
      else debug.runs_written += 1;
    }

    return res.json({
      ok: true,
      debug,
      note: "Runs created. Now call /api/automation/engine/tick to process & send.",
    });
  } catch (e) {
    debug.errors.push(msg(e));
    return res.status(500).json({ ok: false, error: msg(e), debug });
  }
}
