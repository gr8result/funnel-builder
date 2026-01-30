// /pages/api/automation/flows/cleanup-duplicates.js
// POST endpoint to remove duplicate flows (keeps most recent per name)

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

    // Get all user's flows
    const { data: flows, error: flowsErr } = await supabaseAdmin
      .from("automation_flows")
      .select("*")
      .eq("user_id", account_id)
      .eq("is_standard", false)
      .order("name", { ascending: true })
      .order("updated_at", { ascending: false });

    if (flowsErr) {
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch flows",
        detail: flowsErr.message,
      });
    }

    if (!flows || flows.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No flows to clean up",
        deleted: 0,
      });
    }

    // Group by name and keep only the most recent (first in each group due to ordering)
    const flowsByName = {};
    const toDelete = [];

    for (const flow of flows) {
      const name = (flow.name || "").trim().toLowerCase();
      if (!flowsByName[name]) {
        flowsByName[name] = flow;
      } else {
        toDelete.push(flow.id);
      }
    }

    if (toDelete.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No duplicates found",
        deleted: 0,
      });
    }

    // Delete duplicates
    const { error: delErr } = await supabaseAdmin
      .from("automation_flows")
      .delete()
      .in("id", toDelete);

    if (delErr) {
      return res.status(500).json({
        ok: false,
        error: "Failed to delete duplicates",
        detail: delErr.message,
      });
    }

    return res.status(200).json({
      ok: true,
      message: `Removed ${toDelete.length} duplicate flow(s)`,
      deleted: toDelete.length,
    });
  } catch (err) {
    console.error("cleanup-duplicates error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
