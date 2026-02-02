// /pages/api/automation/engine/node-stats.js
// FULL REPLACEMENT — correct per-node counters from automation_email_queue
//
// ✅ trigger_active = count(active members)
// ✅ per node:
//    processed = total rows for node
//    delivered = count(status='sent')
//    opened = sum(open_count)
//    clicked = sum(click_count)

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

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return fallback;
  }
}

export default async function handler(req, res) {
  try {
    const flow_id = String(req.query?.flow_id || "").trim();
    if (!flow_id) return res.status(400).json({ ok: false, error: "Missing flow_id" });

    // active members
    const { count: activeCount, error: memErr } = await supabaseAdmin
      .from("automation_flow_members")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flow_id)
      .eq("status", "active");

    if (memErr) return res.status(500).json({ ok: false, error: memErr.message });

    // queue rows
    const { data: rows, error: qErr } = await supabaseAdmin
      .from("automation_email_queue")
      .select("node_id,status,open_count,click_count")
      .eq("flow_id", flow_id);

    if (qErr) return res.status(500).json({ ok: false, error: qErr.message });

    const stats = {};
    for (const r of rows || []) {
      const nodeId = r.node_id;
      if (!nodeId) continue;
      if (!stats[nodeId]) {
        stats[nodeId] = {
          processed: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          unsubscribed: 0,
        };
      }

      stats[nodeId].processed += 1;
      const status = String(r.status || "").toLowerCase();
      if (status === "sent" || status === "delivered") stats[nodeId].delivered += 1;
      if (status === "bounced" || status === "dropped") stats[nodeId].bounced += 1;
      if (status === "unsubscribed" || status === "unsubscribe") stats[nodeId].unsubscribed += 1;
      stats[nodeId].opened += Number(r.open_count || 0);
      stats[nodeId].clicked += Number(r.click_count || 0);
    }

    // Count active runs at each node (for condition/delay counts)
    const { data: runs, error: runErr } = await supabaseAdmin
      .from("automation_flow_runs")
      .select("current_node_id,status")
      .eq("flow_id", flow_id)
      .in("status", ["active", "waiting_event"]);

    if (runErr) return res.status(500).json({ ok: false, error: runErr.message });

    const counts = {};
    for (const r of runs || []) {
      const nid = String(r.current_node_id || "").trim();
      if (!nid) continue;
      counts[nid] = (counts[nid] || 0) + 1;
    }

    // Load flow nodes so we can mark condition stats
    const { data: flowRow } = await supabaseAdmin
      .from("automation_flows")
      .select("nodes")
      .eq("id", flow_id)
      .maybeSingle();

    const nodes = safeJson(flowRow?.nodes, []);
    for (const n of nodes || []) {
      if (String(n?.type || "").toLowerCase() === "condition") {
        const nid = String(n?.id || "");
        if (!nid) continue;
        if (!stats[nid]) stats[nid] = {};
        stats[nid].activeMembers = counts[nid] || 0;
      }
    }

    return res.json({
      ok: true,
      trigger_active: activeCount || 0,
      stats,
      counts,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
