// /pages/api/automation/engine/repair-flow.js
// Repairs flows that have nodes but missing edges
// This is commonly caused by clicking on nodes without connecting them with edges
// 
// Usage: POST /api/automation/engine/repair-flow
// Body: { flow_id: "uuid", auto_connect: true|false }

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

function findTrigger(nodes) {
  return (nodes || []).find((n) => nodeType(n) === "trigger") || null;
}

function findNodesOfType(nodes, type) {
  return (nodes || []).filter((n) => nodeType(n) === type);
}

function firstOutgoing(edges, fromId) {
  const e = (edges || []).find((x) => String(x?.source) === String(fromId));
  return e?.target ? String(e.target) : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const flow_id = String(req.body?.flow_id || "").trim();
    const auto_connect = req.body?.auto_connect !== false; // default true

    if (!flow_id) {
      return res.status(400).json({ ok: false, error: "flow_id required" });
    }

    // Load flow
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("*")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr || !flow?.id) {
      return res.status(404).json({ ok: false, error: "Flow not found" });
    }

    const nodes = safeJson(flow.nodes, []);
    const edges = safeJson(flow.edges, []);

    // Analyze flow structure
    const analysis = {
      flow_id,
      flow_name: flow.name,
      total_nodes: nodes.length,
      total_edges: edges.length,
      node_types: {},
      issues: [],
      suggestions: [],
    };

    // Count node types
    for (const node of nodes) {
      const type = nodeType(node);
      analysis.node_types[type] = (analysis.node_types[type] || 0) + 1;
    }

    const trigger = findTrigger(nodes);
    if (!trigger?.id) {
      analysis.issues.push("No trigger node found");
    } else {
      analysis.trigger_id = trigger.id;

      // Check if trigger has outgoing edge
      const outgoing = firstOutgoing(edges, trigger.id);
      if (!outgoing) {
        analysis.issues.push(
          `Trigger node "${trigger.id}" has NO outgoing edges! Members will not advance.`
        );

        // Look for email nodes to auto-connect
        const emailNodes = findNodesOfType(nodes, "email");
        if (emailNodes.length > 0) {
          analysis.suggestions.push(
            `Found ${emailNodes.length} email node(s). Can auto-connect trigger to first email node.`
          );

          if (auto_connect) {
            // Create edge from trigger to first email node
            const newEdge = {
              id: `edge-${trigger.id}-${emailNodes[0].id}`,
              source: trigger.id,
              target: emailNodes[0].id,
              animated: true,
            };

            const updatedEdges = [...edges, newEdge];

            // Save flow with new edge
            const { error: updateErr } = await supabaseAdmin
              .from("automation_flows")
              .update({
                edges: updatedEdges,
                updated_at: new Date().toISOString(),
              })
              .eq("id", flow_id);

            if (updateErr) {
              analysis.repair_attempted = true;
              analysis.repair_error = updateErr.message;
            } else {
              analysis.repair_attempted = true;
              analysis.repair_successful = true;
              analysis.repair_details = {
                action: "Created edge from trigger to first email node",
                edge: newEdge,
                total_edges_after: updatedEdges.length,
              };
            }
          }
        } else {
          analysis.issues.push("No email nodes found to connect");
        }
      } else {
        analysis.trigger_outgoing_to = outgoing;
        analysis.suggestions.push("Trigger has outgoing edge (looks good)");
      }
    }

    // Check for orphaned nodes (nodes with no incoming or outgoing edges)
    const connectedNodes = new Set();
    for (const edge of edges) {
      if (edge.source) connectedNodes.add(edge.source);
      if (edge.target) connectedNodes.add(edge.target);
    }

    const orphanedNodes = nodes.filter((n) => !connectedNodes.has(n.id) && n.id !== trigger?.id);
    if (orphanedNodes.length > 0) {
      analysis.issues.push(
        `${orphanedNodes.length} orphaned node(s) with no edges: ${orphanedNodes.map((n) => n.id).join(", ")}`
      );
    }

    return res.json({ ok: true, analysis });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
