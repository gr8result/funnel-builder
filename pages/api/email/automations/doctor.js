// /pages/api/email/automations/doctor.js
// FULL REPLACEMENT — ONE endpoint that tells us EXACTLY why nothing is moving/sending
//
// Call (GET):
//   /api/email/automations/doctor?flow_id=...&lead_id=...
//
// It will:
// ✅ Show the latest automation_queue row for that lead+flow (or all rows if not provided)
// ✅ Show whether your worker would SELECT it (pending + run_at <= now)
// ✅ Show the flow graph summary (node ids + types + first trigger->next path)
// ✅ Show if SendGrid key is present on the server
// ✅ Try a “dry-run” step resolution (what node it thinks it’s on + next node)
//
// NOTE: This does NOT change data. It only reports.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const SENDGRID_KEY =
  process.env.GR8_MAIL_SEND_ONLY || process.env.SENDGRID_API_KEY;

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

function firstOutgoing(edges, fromId) {
  const e = (edges || []).find((x) => String(x?.source) === String(fromId));
  return e?.target ? String(e.target) : null;
}

function nodeTypeOf(node) {
  return String(node?.type || node?.data?.type || "").toLowerCase();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const nowIso = new Date().toISOString();
    const flow_id = String(req.query.flow_id || "").trim();
    const lead_id = String(req.query.lead_id || "").trim();

    // 1) Queue rows
    let q = supabaseAdmin
      .from("automation_queue")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (flow_id) q = q.eq("flow_id", flow_id);
    if (lead_id) q = q.eq("lead_id", lead_id);

    const { data: queueRows, error: qErr } = await q;

    // 2) Flow graph
    let flow = null;
    let nodes = [];
    let edges = [];
    let flowErr = null;

    if (flow_id) {
      const { data: f, error: fErr } = await supabaseAdmin
        .from("automation_flows")
        .select("id,name,nodes,edges,updated_at,user_id,is_standard")
        .eq("id", flow_id)
        .maybeSingle();

      if (fErr) flowErr = fErr.message;
      flow = f || null;
      nodes = safeJson(f?.nodes, []);
      edges = safeJson(f?.edges, []);
    }

    // 3) Graph summary
    const trigger =
      (nodes || []).find((n) => String(n?.type).toLowerCase() === "trigger") ||
      null;

    const triggerId = trigger?.id ? String(trigger.id) : null;
    const firstAfterTrigger = triggerId ? firstOutgoing(edges, triggerId) : null;

    const nodeSummary = (nodes || []).slice(0, 200).map((n) => ({
      id: String(n?.id ?? ""),
      type: String(n?.type ?? ""),
      dataType: String(n?.data?.type ?? ""),
      label: String(n?.data?.label ?? n?.data?.title ?? ""),
    }));

    // 4) “Would worker pick this up?”
    const latest = (queueRows || [])[0] || null;
    const wouldRun =
      !!latest &&
      String(latest.status) === "pending" &&
      String(latest.run_at) <= nowIso;

    // 5) Dry-run step resolution
    let dry = null;
    if (latest && nodes?.length) {
      const curId = String(latest.next_node_id || "");
      const cur = (nodes || []).find((n) => String(n?.id) === curId) || null;
      const next = cur?.id ? firstOutgoing(edges, String(cur.id)) : null;
      dry = {
        current_node_id: curId,
        current_node_found: !!cur,
        current_node_type: cur ? nodeTypeOf(cur) : null,
        next_node_id: next,
      };
    }

    return res.status(200).json({
      ok: true,
      now: nowIso,
      env: {
        hasSupabaseUrl: !!SUPABASE_URL,
        hasServiceKey: !!SERVICE_KEY,
        hasSendGridKey: !!SENDGRID_KEY,
      },
      queue: {
        error: qErr?.message || null,
        count: queueRows?.length || 0,
        latest,
        would_worker_select_latest: wouldRun,
      },
      flow: flow_id
        ? {
            error: flowErr,
            id: flow?.id || null,
            name: flow?.name || null,
            updated_at: flow?.updated_at || null,
            node_count: nodes?.length || 0,
            edge_count: edges?.length || 0,
            trigger_node_id: triggerId,
            first_after_trigger: firstAfterTrigger,
            nodes_preview: nodeSummary,
          }
        : null,
      dry_run: dry,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
