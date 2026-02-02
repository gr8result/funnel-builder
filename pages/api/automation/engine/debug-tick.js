// /pages/api/automation/engine/debug-tick.js
// Debug endpoint to diagnose why members aren't being sent to email nodes
// POST with { flow_id: "uuid" } to debug a specific flow

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE ||
  "";

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

function nodeType(n) {
  return String(n?.type || n?.data?.type || "").toLowerCase();
}

function firstOutgoing(edges, fromId) {
  const e = (edges || []).find((x) => String(x?.source) === String(fromId));
  return e?.target ? String(e.target) : null;
}

function findTrigger(nodes) {
  return (nodes || []).find((n) => nodeType(n) === "trigger") || null;
}

function findNode(nodes, id) {
  return (nodes || []).find((n) => String(n?.id) === String(id)) || null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const flow_id = String(req.body?.flow_id || "").trim();
    if (!flow_id) {
      return res.status(400).json({ ok: false, error: "flow_id required in body" });
    }

    const debug = {
      flow_id,
      flow_found: false,
      nodes_parsed: false,
      edges_parsed: false,
      trigger_found: false,
      first_outgoing: null,
      first_node: null,
      first_node_type: null,
      members_found: 0,
      errors: [],
      warnings: [],
      raw_flow: null,
    };

    // Load the flow
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,name,nodes,edges")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr) {
      debug.errors.push(`Flow query error: ${flowErr.message}`);
      return res.status(500).json({ ok: false, debug });
    }

    if (!flow?.id) {
      debug.errors.push("Flow not found in database");
      return res.status(404).json({ ok: false, debug });
    }

    debug.flow_found = true;
    debug.raw_flow = {
      id: flow.id,
      name: flow.name,
      user_id: flow.user_id,
      nodes_type: typeof flow.nodes,
      edges_type: typeof flow.edges,
    };

    // Parse nodes and edges
    const nodes = safeJson(flow.nodes, []);
    const edges = safeJson(flow.edges, []);

    debug.nodes_parsed = true;
    debug.edges_parsed = true;

    if (!Array.isArray(nodes)) {
      debug.errors.push(`nodes is not an array: ${typeof nodes}`);
    }
    if (!Array.isArray(edges)) {
      debug.errors.push(`edges is not an array: ${typeof edges}`);
    }

    // Find trigger
    const trigger = findTrigger(nodes);
    if (!trigger?.id) {
      debug.warnings.push("No trigger node found in flow");
    } else {
      debug.trigger_found = true;
      debug.trigger = {
        id: trigger.id,
        type: nodeType(trigger),
        label: trigger.data?.label || trigger.label || "Unnamed",
      };
    }

    // Find first outgoing from trigger
    if (trigger?.id) {
      const firstAfterId = firstOutgoing(edges, trigger.id);
      debug.first_outgoing = firstAfterId;

      if (!firstAfterId) {
        debug.errors.push(
          `No edge found from trigger "${trigger.id}". Edges in flow: ${edges.length}`
        );
        if (edges.length > 0) {
          debug.edges_sample = edges.slice(0, 3).map((e) => ({
            source: e.source,
            target: e.target,
          }));
        }
      } else {
        const firstNode = findNode(nodes, firstAfterId);
        debug.first_node = {
          id: firstAfterId,
          found: !!firstNode,
          type: nodeType(firstNode),
          label: firstNode?.data?.label || firstNode?.label || "Unnamed",
        };

        if (!firstNode) {
          debug.errors.push(
            `First node after trigger ("${firstAfterId}") not found in nodes array`
          );
        }

        const firstType = nodeType(firstNode);
        if (firstType === "email") {
          debug.first_node_type = "email";
        } else if (firstType) {
          debug.warnings.push(
            `First node is type "${firstType}", not "email". Flow will not queue emails.`
          );
        }
      }
    }

    // Count members
    const { data: members, error: memErr } = await supabaseAdmin
      .from("automation_flow_members")
      .select("id,lead_id,status")
      .eq("flow_id", flow_id)
      .eq("status", "active");

    if (memErr) {
      debug.errors.push(`Members query error: ${memErr.message}`);
    } else {
      debug.members_found = (members || []).length;
      if (members && members.length > 0) {
        debug.member_sample = members.slice(0, 3).map((m) => ({
          id: m.id,
          lead_id: m.lead_id,
          status: m.status,
        }));
      }
    }

    // Summary
    const shouldQueue =
      trigger?.id &&
      debug.first_outgoing &&
      debug.first_node_type === "email" &&
      debug.members_found > 0;

    debug.summary = {
      ready_to_queue: shouldQueue,
      has_trigger: !!trigger?.id,
      has_edge_from_trigger: !!debug.first_outgoing,
      first_is_email: debug.first_node_type === "email",
      has_members: debug.members_found > 0,
    };

    return res.json({ ok: true, debug });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack,
    });
  }
}
