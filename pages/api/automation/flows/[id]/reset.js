// /pages/api/automation/flows/[id]/reset.js
// POST endpoint to reset (delete) all data for a flow
// 
// Body: { confirm_deletion: boolean }
//
// This deletes:
// - automation_logs
// - automation_queue
// - automation_email_queue
// - automation_flow_members

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
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST" });
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

    // Verify ownership
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id, user_id")
      .eq("id", flow_id)
      .single();

    if (flowErr || !flow) {
      return res.status(404).json({ ok: false, error: "Flow not found" });
    }

    if (flow.user_id !== account_id) {
      return res
        .status(403)
        .json({ ok: false, error: "Unauthorized to reset this flow" });
    }

    // Confirm deletion
    if (req.body?.confirm_deletion !== true) {
      return res.status(400).json({
        ok: false,
        error: "Must confirm deletion with confirm_deletion: true",
      });
    }

    // Delete flow members
    const { error: delMembersErr } = await supabaseAdmin
      .from("automation_flow_members")
      .delete()
      .eq("flow_id", flow_id);

    if (delMembersErr) {
      console.error("Error deleting flow members:", delMembersErr);
      return res.status(500).json({
        ok: false,
        error: "Failed to delete flow members",
        detail: delMembersErr.message,
      });
    }

    // Delete automation queue entries
    const { error: delQueueErr } = await supabaseAdmin
      .from("automation_queue")
      .delete()
      .eq("flow_id", flow_id);

    if (delQueueErr) {
      console.error("Error deleting queue entries:", delQueueErr);
      // Don't fail if this table doesn't exist, just log it
    }

    // Delete queued emails
    const { error: delEmailsErr } = await supabaseAdmin
      .from("automation_email_queue")
      .delete()
      .eq("flow_id", flow_id);

    if (delEmailsErr) {
      console.error("Error deleting email queue:", delEmailsErr);
      // Don't fail if this table doesn't exist, just log it
    }

    // Delete logs
    const { error: delLogsErr } = await supabaseAdmin
      .from("automation_logs")
      .delete()
      .eq("flow_id", flow_id);

    if (delLogsErr) {
      console.error("Error deleting logs:", delLogsErr);
      // Don't fail if this table doesn't exist, just log it
    }

    return res.status(200).json({
      ok: true,
      message: "Flow data cleared successfully",
      flow_id,
    });
  } catch (err) {
    console.error("flows/reset error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
