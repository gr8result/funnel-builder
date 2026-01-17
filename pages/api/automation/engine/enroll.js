// /pages/api/automation/engine/enroll.js
// FULL REPLACEMENT
//
// ✅ FIXES: members/runs not created because user_id was missing
// ✅ Uses leads.user_id (auth.users.id) as the ONLY correct user_id for:
//    - automation_flow_members.user_id
//    - automation_flow_runs.user_id
// ✅ Supports list_subscribed / lead_created / crm_sent event matching
// ✅ Handles your mixed ownership model:
//    - automation_flows.user_id is accounts.id (NOT auth uid)
//    - leads.user_id is auth.users.id
// We map auth uid -> accounts.id when filtering flow ownership.
//
// POST examples:
// 1) List subscription event (new subscriber added):
//    { lead_id, list_id, event: "list_subscribed" }
//
// 2) Lead created:
//    { lead_id, event: "lead_created" }
//
// 3) CRM send (manual):
//    { lead_id, event: "crm_sent" }
//
// 4) Forced enrollment to a flow:
//    { lead_id, flow_id, event: "manual" }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const NOW = () => new Date().toISOString();

function safeJson(x, fallback) {
  try {
    if (Array.isArray(x)) return x;
    if (typeof x === "string") return JSON.parse(x || "[]");
    return x ?? fallback;
  } catch {
    return fallback;
  }
}

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function isMissing(err) {
  const code = String(err?.code || "");
  const m = msg(err).toLowerCase();
  return (
    code === "42P01" || // undefined_table
    code === "42703" || // undefined_column
    m.includes("does not exist") ||
    m.includes("undefined column") ||
    m.includes("relation")
  );
}

async function getLeadOwnerUserId(lead_id) {
  const { data, error } = await supabase
    .from("leads")
    .select("id,user_id")
    .eq("id", lead_id)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) return null;
  return data.user_id || null; // auth.users.id
}

async function getAccountIdForUser(auth_user_id) {
  if (!auth_user_id) return null;
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", auth_user_id)
    .maybeSingle();
  if (error) return null;
  return data?.id || null; // accounts.id
}

async function insertMembership({ flow_id, lead_id, user_id, source = "event" }) {
  // Your real schema is automation_flow_members with NOT NULL user_id.
  const payload = [
    {
      user_id,
      flow_id,
      lead_id,
      source,
      status: "active",
      created_at: NOW(),
      updated_at: NOW(),
    },
  ];

  // Upsert preferred (you have UNIQUE(flow_id,lead_id))
  const { error: upErr } = await supabase
    .from("automation_flow_members")
    .upsert(payload, { onConflict: "flow_id,lead_id" });

  if (!upErr) return { ok: true, mode: "upsert" };

  // If upsert fails due to missing constraint wording, fallback to insert
  const m = msg(upErr).toLowerCase();
  const maybeNoConstraint =
    m.includes("no unique") || m.includes("no exclusion constraint") || m.includes("on conflict");

  if (!maybeNoConstraint) {
    // could be missing columns/table etc
    throw upErr;
  }

  const { error: insErr } = await supabase.from("automation_flow_members").insert(payload);
  if (insErr) {
    const mm = msg(insErr).toLowerCase();
    if (mm.includes("duplicate") || mm.includes("unique")) {
      return { ok: true, mode: "already" };
    }
    throw insErr;
  }

  return { ok: true, mode: "insert" };
}

async function ensureRun({ flow_id, lead_id, user_id }) {
  // Your automation_flow_runs has NOT NULL user_id.
  const now = NOW();

  const { data: existing, error: exErr } = await supabase
    .from("automation_flow_runs")
    .select("id,status")
    .eq("flow_id", flow_id)
    .eq("lead_id", lead_id)
    .eq("user_id", user_id)
    .in("status", ["active", "waiting_event"])
    .maybeSingle();

  if (!exErr && existing?.id) {
    return { ok: true, created: false, run_id: existing.id, status: existing.status };
  }

  const { data: ins, error: insErr } = await supabase
    .from("automation_flow_runs")
    .insert([
      {
        user_id,
        flow_id,
        lead_id,
        status: "active",
        available_at: now,
        current_node_id: null, // start at trigger
        last_error: null,
        created_at: now,
        updated_at: now,
      },
    ])
    .select("id,status")
    .maybeSingle();

  if (insErr) {
    const m = msg(insErr).toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return { ok: true, created: false, note: "race duplicate" };
    }
    throw insErr;
  }

  return { ok: true, created: true, run_id: ins?.id, status: ins?.status };
}

function flowMatchesEvent(flow, { event, list_id }) {
  const nodes = safeJson(flow.nodes, []);
  const e = String(event || "").trim();

  // Find trigger node
  const trig = nodes.find((n) => n?.type === "trigger");
  if (!trig) return false;

  const d = trig.data || {};
  const t = String(d.triggerType || "").trim();

  if (e === "list_subscribed") {
    if (t !== "list_subscribed") return false;
    const nodeListId = String(d.listId || "");
    return nodeListId && String(list_id || "") && nodeListId === String(list_id);
  }

  if (e === "lead_created") return t === "lead_created";
  if (e === "crm_sent") return t === "crm_sent";

  return false;
}

async function tryRunDbEngine(flow_id) {
  // You showed a routine named run_automation_engine exists in your DB.
  // If it’s missing in some environments, we do NOT fail enrollment.
  try {
    const { error } = await supabase.rpc("run_automation_engine", {
      p_flow_id: flow_id,
    });
    if (error && !isMissing(error)) {
      // non-missing error: still don't fail enrollment
    }
  } catch {
    // ignore
  }
}

export default async function handler(req, res) {
  const debug = {
    flow_id: null,
    lead_id: null,
    list_id: null,
    event: null,
    lead_owner_user_id: null,
    account_id: null,
    forced: false,
    matched_flows: 0,
    enrolled_flows: 0,
    runs_created: 0,
    runs_existing: 0,
    errors: [],
  };

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const { lead_id, flow_id, event, list_id } = req.body || {};
    debug.lead_id = lead_id || null;
    debug.flow_id = flow_id || null;
    debug.list_id = list_id || null;
    debug.event = event || null;

    if (!lead_id) {
      return res.status(400).json({ ok: false, error: "lead_id required", debug });
    }

    // 1) Resolve the ONLY correct user_id for this enrollment: the lead owner (auth.users.id)
    const lead_owner_user_id = await getLeadOwnerUserId(lead_id);
    debug.lead_owner_user_id = lead_owner_user_id;

    if (!lead_owner_user_id) {
      return res.status(404).json({ ok: false, error: "Lead not found / no owner", debug });
    }

    // Map to accounts.id because automation_flows.user_id is accounts.id in your current schema
    const account_id = await getAccountIdForUser(lead_owner_user_id);
    debug.account_id = account_id;

    // 2) Forced/manual enrollment into a specific flow
    if (flow_id) {
      debug.forced = true;

      // (Optional) ownership check: flow.user_id/account_id must match this user’s account_id or auth id
      const { data: flowRow, error: flowErr } = await supabase
        .from("automation_flows")
        .select("id,user_id,account_id")
        .eq("id", flow_id)
        .maybeSingle();

      if (flowErr) throw flowErr;
      if (!flowRow?.id) return res.status(404).json({ ok: false, error: "Flow not found", debug });

      const flowOwner = flowRow.account_id || flowRow.user_id || null;
      if (flowOwner && account_id && flowOwner !== account_id && flowOwner !== lead_owner_user_id) {
        return res.status(403).json({ ok: false, error: "Not allowed for this flow", debug });
      }

      await insertMembership({
        flow_id,
        lead_id,
        user_id: lead_owner_user_id,
        source: event || "manual",
      });

      const run = await ensureRun({
        flow_id,
        lead_id,
        user_id: lead_owner_user_id,
      });

      // Kick DB engine if available
      await tryRunDbEngine(flow_id);

      return res.json({
        ok: true,
        mode: "forced",
        flow_id,
        run,
        debug,
      });
    }

    // 3) Event-based enrollment: find matching flows
    const ev = String(event || "").trim();
    if (!ev) {
      return res.status(400).json({
        ok: false,
        error: "event required when flow_id is not provided",
        hint: 'Use { event:"list_subscribed", list_id } or { event:"lead_created" }',
        debug,
      });
    }

    // Pull flows; filter by owner if possible (account_id)
    let flows = [];
    {
      const { data, error } = await supabase
        .from("automation_flows")
        .select("id,name,nodes,is_standard,user_id,account_id");
      if (error) throw error;
      flows = Array.isArray(data) ? data : [];
    }

    // Restrict to this user’s flows if we can
    const ownedFlows = flows.filter((f) => {
      const owner = f.account_id || f.user_id || null;
      if (!owner) return true; // tolerate older rows
      if (account_id && owner === account_id) return true;
      if (owner === lead_owner_user_id) return true;
      return false;
    });

    const matching = ownedFlows.filter((f) => flowMatchesEvent(f, { event: ev, list_id }));
    debug.matched_flows = matching.length;

    if (!matching.length) {
      return res.json({
        ok: true,
        enrolled_flows: 0,
        note:
          ev === "list_subscribed"
            ? "No flows matched this list trigger. Ensure Trigger is 'Subscribed to List' and a list is selected."
            : "No flows matched this event trigger.",
        debug,
      });
    }

    let enrolled_flows = 0;
    let runs_created = 0;
    let runs_existing = 0;

    for (const f of matching) {
      await insertMembership({
        flow_id: f.id,
        lead_id,
        user_id: lead_owner_user_id,
        source: ev,
      });

      const run = await ensureRun({
        flow_id: f.id,
        lead_id,
        user_id: lead_owner_user_id,
      });

      enrolled_flows++;
      if (run.created) runs_created++;
      else runs_existing++;

      // Kick DB engine if available
      await tryRunDbEngine(f.id);
    }

    debug.enrolled_flows = enrolled_flows;
    debug.runs_created = runs_created;
    debug.runs_existing = runs_existing;

    return res.json({
      ok: true,
      mode: "event",
      event: ev,
      enrolled_flows,
      runs_created,
      runs_existing,
      debug,
    });
  } catch (err) {
    debug.errors.push(msg(err));
    console.error("automation/engine/enroll error:", err);
    return res.status(500).json({ ok: false, error: msg(err), debug });
  }
}
