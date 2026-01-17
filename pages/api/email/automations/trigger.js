// /pages/api/email/automations/trigger.js
// FULL REPLACEMENT
//
// ✅ Uses Bearer token to get real auth user_id (no hardcoding)
// ✅ Inserts into automation_queue using YOUR schema types
// ✅ lead_id and list_id stored as TEXT (as per your automation_queue definition)
// ✅ next_node_id must be a node id like "trigger-1" or "email-1"

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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    // Validate token => get auth user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session token" });
    }

    const user_id = userData.user.id;

    const { lead_id, list_id, flow_id, next_node_id } = req.body || {};

    if (!lead_id || !flow_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing lead_id or flow_id",
      });
    }

    const nowIso = new Date().toISOString();

    // If next_node_id not provided, start at trigger-1 (your flow uses trigger-1)
    const startNode = String(next_node_id || "trigger-1");

    const row = {
      user_id,                        // uuid
      subscriber_id: null,            // optional uuid
      flow_id,                        // uuid
      next_node_id: startNode,        // text
      run_at: nowIso,                 // timestamptz
      status: "pending",              // pending/running/done/failed
      created_at: nowIso,
      updated_at: nowIso,
      lead_id: String(lead_id),       // TEXT in your schema
      list_id: list_id ? String(list_id) : null, // TEXT in your schema
      contact_id: null,               // optional uuid
    };

    const { error } = await supabaseAdmin.from("automation_queue").insert([row]);
    if (error) throw new Error(error.message);

    return res.status(200).json({
      ok: true,
      message: "✅ Job added to automation_queue",
      queued: { flow_id, lead_id: String(lead_id), next_node_id: startNode },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
