// /pages/api/automation/flows/[id]/delete.js
// DELETE endpoint to delete a flow

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.warn("Missing SUPABASE_URL env");
}
if (!SERVICE_KEY) {
  console.warn("Missing SUPABASE_SERVICE_ROLE_KEY env");
}

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
    if (req.method !== "DELETE") {
      res.setHeader("Allow", "DELETE");
      return res.status(405).json({ ok: false, error: "Use DELETE" });
    }

    const token = getBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    const auth_user_id = userData.user.id;

    // Get account_id from auth user
    const { data: account, error: accErr } = await supabaseAdmin
      .from("accounts")
      .select("id")
      .eq("user_id", auth_user_id)
      .single();

    if (accErr || !account?.id) {
      return res.status(400).json({
        ok: false,
        error: "Could not find account for this user",
      });
    }

    const account_id = account.id;
    const flow_id = req.query.id;

    if (!flow_id) {
      return res.status(400).json({ ok: false, error: "Missing flow_id" });
    }

    // Verify ownership and not a system template
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id, user_id, is_standard")
      .eq("id", flow_id)
      .single();

    if (flowErr || !flow) {
      return res.status(404).json({ ok: false, error: "Flow not found" });
    }

    if (flow.user_id !== account_id) {
      return res
        .status(403)
        .json({ ok: false, error: "Unauthorized to delete this flow" });
    }

    if (flow.is_standard) {
      return res
        .status(403)
        .json({ ok: false, error: "Cannot delete system templates" });
    }

    // Delete the flow
    const { error: delErr } = await supabaseAdmin
      .from("automation_flows")
      .delete()
      .eq("id", flow_id);

    if (delErr) {
      return res.status(500).json({
        ok: false,
        error: "Failed to delete flow",
        detail: delErr.message,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Flow deleted successfully",
      flow_id,
    });
  } catch (err) {
    console.error("flows/delete error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
