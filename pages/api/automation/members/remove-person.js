// /pages/api/automation/members/remove-person.js
// FULL REPLACEMENT
//
// ✅ Removes a lead from a flow (automation_flow_members)
// ✅ Clears any in-progress run state for that lead+flow (automation_flow_runs)
// ✅ Clears any queued emails for that lead+flow (automation_email_queue)
// ✅ DOES NOT reference automation_queue (you do NOT have that table)
//
// Auth:
//   Authorization: Bearer <supabase_access_token>
//
// Body:
//   { flow_id, lead_id }
//
// Returns:
//   { ok:true, removed_members, removed_runs, removed_emails }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const ANON_KEY =
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

const SERVICE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE ||
    "").trim();

function getBearer(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env (URL / ANON / SERVICE ROLE).",
      });
    }

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { flow_id, lead_id } = req.body || {};
    if (!flow_id || !lead_id) {
      return res.status(400).json({ ok: false, error: "Missing flow_id or lead_id" });
    }

    // 1) Validate user (who is calling)
    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session token" });
    }
    const auth_user_id = userData.user.id;

    // 2) Admin client (service role) to delete rows
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3) Multi-tenant safety: verify flow belongs to this auth user via automation_flows.user_id (accounts.id) -> accounts.user_id (auth uid)
    // We do this by reading the flow and matching through accounts.
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id")
      .eq("id", String(flow_id))
      .maybeSingle();

    if (flowErr) return res.status(500).json({ ok: false, error: flowErr.message });
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found" });

    // flow.user_id is accounts.id (based on your earlier schema notes)
    const { data: acct, error: acctErr } = await supabaseAdmin
      .from("accounts")
      .select("id,user_id")
      .eq("id", String(flow.user_id))
      .maybeSingle();

    if (acctErr) return res.status(500).json({ ok: false, error: acctErr.message });
    if (!acct?.id || String(acct.user_id) !== String(auth_user_id)) {
      return res.status(403).json({ ok: false, error: "Not allowed for this flow" });
    }

    // 4) Delete the member
    const { error: delMemErr, count: removed_members } = await supabaseAdmin
      .from("automation_flow_members")
      .delete({ count: "exact" })
      .eq("flow_id", String(flow_id))
      .eq("lead_id", String(lead_id));

    if (delMemErr) return res.status(500).json({ ok: false, error: delMemErr.message });

    // 5) Clear any run state (table exists in your screenshots)
    let removed_runs = 0;
    try {
      const { error: delRunsErr, count } = await supabaseAdmin
        .from("automation_flow_runs")
        .delete({ count: "exact" })
        .eq("flow_id", String(flow_id))
        .eq("lead_id", String(lead_id));

      if (!delRunsErr) removed_runs = count || 0;
    } catch {
      // ignore if table/columns differ
    }

    // 6) Clear queued emails for this lead in this flow
    let removed_emails = 0;
    try {
      const { error: delEmailErr, count } = await supabaseAdmin
        .from("automation_email_queue")
        .delete({ count: "exact" })
        .eq("flow_id", String(flow_id))
        .eq("lead_id", String(lead_id));

      if (!delEmailErr) removed_emails = count || 0;
    } catch {
      // ignore if table/columns differ
    }

    return res.status(200).json({
      ok: true,
      removed_members: removed_members || 0,
      removed_runs,
      removed_emails,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
