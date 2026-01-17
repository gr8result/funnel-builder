// /pages/api/automation/members/remove-person.js
// FULL REPLACEMENT
// POST { flow_id, lead_id }
//
// ✅ Removes a lead from a flow (automation_flow_members)
// ✅ ALSO deletes ALL automation_queue rows for that flow+lead (so you can re-trigger cleanly)
// ✅ Safe: derives user from Bearer token
// ✅ Uses service role key for server-side delete
//
// IMPORTANT:
// - Keeps your existing auth/ownership checks exactly as you had them
// - Only change: after membership delete, we wipe the queue rows for that member in that flow

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST" });
    }

    const token = getBearer(req);
    if (!token) {
      return res
        .status(401)
        .json({ ok: false, error: "Missing Bearer token" });
    }

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    const auth_user_id = userData.user.id;

    const flow_id = String(req.body?.flow_id || "").trim();
    const lead_id = String(req.body?.lead_id || "").trim();

    if (!flow_id)
      return res.status(400).json({ ok: false, error: "Missing flow_id" });
    if (!lead_id)
      return res.status(400).json({ ok: false, error: "Missing lead_id" });

    // Ensure this flow belongs to this user (via accounts.id stored in automation_flows.user_id)
    const { data: flowRow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr)
      return res.status(500).json({ ok: false, error: flowErr.message });
    if (!flowRow)
      return res.status(404).json({ ok: false, error: "Flow not found" });

    // flowRow.user_id is accounts.id (your schema), so we must validate via accounts lookup
    const { data: acc, error: accErr } = await supabaseAdmin
      .from("accounts")
      .select("id,user_id")
      .eq("id", flowRow.user_id)
      .maybeSingle();

    if (accErr)
      return res.status(500).json({ ok: false, error: accErr.message });
    if (!acc || String(acc.user_id) !== String(auth_user_id)) {
      return res.status(403).json({ ok: false, error: "Not allowed" });
    }

    // 1) Hard delete membership row
    const { error: delMemberErr } = await supabaseAdmin
      .from("automation_flow_members")
      .delete()
      .eq("flow_id", flow_id)
      .eq("lead_id", lead_id);

    if (delMemberErr)
      return res.status(500).json({ ok: false, error: delMemberErr.message });

    // 2) Wipe queue rows for this flow+lead (so it can re-trigger cleanly)
    const { error: delQueueErr } = await supabaseAdmin
      .from("automation_queue")
      .delete()
      .eq("flow_id", flow_id)
      .eq("lead_id", lead_id);

    if (delQueueErr) {
      return res.status(500).json({
        ok: false,
        error: `Member removed but failed to clear queue: ${delQueueErr.message}`,
      });
    }

    return res.status(200).json({ ok: true, cleared_queue: true });
  } catch (err) {
    console.error("remove-person error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
