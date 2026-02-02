// /pages/api/automation/diagnose.js
// Quick diagnostic endpoint to check automation system health
// GET /api/automation/diagnose?flow_id=<uuid>

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function safeJson(v) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const flow_id = String(req.query?.flow_id || "").trim();
    if (!flow_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing flow_id query param",
        example: "/api/automation/diagnose?flow_id=<uuid>",
      });
    }

    const report = {
      flow_id,
      timestamp: new Date().toISOString(),
      checks: {},
    };

    // CHECK 1: Flow exists and has data
    const { data: flow, error: flowErr } = await supabase
      .from("automation_flows")
      .select("id,name,nodes,edges,user_id,created_at")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr || !flow) {
      report.checks.flow_found = false;
      report.checks.flow_error = flowErr?.message;
      return res.status(404).json({ ok: false, report });
    }

    report.checks.flow_found = true;
    report.flow_name = flow.name;
    report.flow_created = flow.created_at;

    // CHECK 2: Parse nodes/edges
    const nodes = safeJson(flow.nodes) || [];
    const edges = safeJson(flow.edges) || [];

    report.checks.nodes_count = nodes.length;
    report.checks.edges_count = edges.length;
    report.checks.nodes_valid = Array.isArray(nodes);
    report.checks.edges_valid = Array.isArray(edges);

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      report.checks.structure_error = "nodes or edges not arrays";
      return res.status(200).json({ ok: true, report });
    }

    // CHECK 3: Find trigger and email nodes
    const trigger = nodes.find((n) => {
      const type = String(n?.type || n?.data?.type || "").toLowerCase();
      return type === "trigger";
    });

    const emailNodes = nodes.filter((n) => {
      const type = String(n?.type || n?.data?.type || "").toLowerCase();
      return type === "email";
    });

    report.checks.trigger_found = !!trigger?.id;
    report.checks.trigger_id = trigger?.id || null;
    report.checks.email_nodes_count = emailNodes.length;
    report.checks.email_node_ids = emailNodes.map((n) => n.id);

    if (!trigger?.id) {
      report.checks.issue = "NO TRIGGER NODE - flow cannot start";
      return res.status(200).json({ ok: true, report });
    }

    if (emailNodes.length === 0) {
      report.checks.issue = "NO EMAIL NODES - flow will not send emails";
      return res.status(200).json({ ok: true, report });
    }

    // CHECK 4: Check for edge from trigger
    const triggerEdge = edges.find((e) => String(e?.source) === String(trigger.id));
    report.checks.trigger_has_outgoing_edge = !!triggerEdge;

    if (!triggerEdge) {
      report.checks.issue = "MISSING EDGE - Trigger has no outgoing connection!";
      report.checks.solution = "Connect trigger to email node in UI, or use /api/automation/engine/repair-flow";
      return res.status(200).json({ ok: true, report });
    }

    report.checks.trigger_connects_to = triggerEdge.target;

    // CHECK 5: Verify trigger connects to email node
    const firstNode = nodes.find((n) => n.id === triggerEdge.target);
    const firstType = String(firstNode?.type || firstNode?.data?.type || "").toLowerCase();

    if (firstType !== "email") {
      report.checks.issue = `First node is ${firstType}, not email - emails won't queue`;
      return res.status(200).json({ ok: true, report });
    }

    report.checks.first_node_is_email = true;
    report.checks.first_email_node = firstNode.id;

    // CHECK 6: Check members
    const { count: memberCount, error: memErr } = await supabase
      .from("automation_flow_members")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flow_id)
      .eq("status", "active");

    report.checks.members_count = memberCount || 0;
    report.checks.members_error = memErr?.message || null;

    // CHECK 7: Check email queue
    const { count: queueCount, error: qErr } = await supabase
      .from("automation_email_queue")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flow_id);

    report.checks.queued_emails_count = queueCount || 0;
    report.checks.queue_error = qErr?.message || null;

    // CHECK 8: Check runs
    const { count: runCount, error: rErr } = await supabase
      .from("automation_flow_runs")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flow_id)
      .eq("status", "active");

    report.checks.active_runs_count = runCount || 0;
    report.checks.runs_error = rErr?.message || null;

    // SUMMARY
    const hasAllStructure =
      trigger?.id &&
      triggerEdge &&
      firstType === "email" &&
      (memberCount || 0) > 0;

    if (hasAllStructure && (queueCount || 0) === 0) {
      report.checks.summary =
        "⚠️ Flow structure looks good but email queue is empty. Call /api/automation/engine/tick to queue emails.";
    } else if (hasAllStructure && (queueCount || 0) > 0) {
      report.checks.summary =
        "✅ Flow looks healthy. Emails are queued. Call /api/automation/email/flush-queue to send.";
    } else if (hasAllStructure) {
      report.checks.summary =
        "✅ Flow structure is correct, but no members yet or emails not queued.";
    }

    return res.json({ ok: true, report });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
