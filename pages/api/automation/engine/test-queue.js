// Test endpoint to directly test email queue insertion
// POST /api/automation/engine/test-queue
// Body: { flow_id, lead_id, node_id }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const { flow_id, lead_id, node_id } = req.body;

    if (!flow_id || !lead_id || !node_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields",
        required: ["flow_id", "lead_id", "node_id"],
      });
    }

    // Get flow to get user_id
    const { data: flow, error: flowErr } = await supabase
      .from("automation_flows")
      .select("id,user_id")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr || !flow) {
      return res.status(404).json({
        ok: false,
        error: "Flow not found",
        detail: flowErr?.message,
      });
    }

    const now = new Date().toISOString();

    // Try minimal insert first
    const minimalRow = {
      user_id: flow.user_id,
      flow_id,
      lead_id,
      node_id,
      status: "queued",
      created_at: now,
      updated_at: now,
    };

    console.log("Attempting minimal insert:", minimalRow);

    const { data: inserted, error: insErr } = await supabase
      .from("automation_email_queue")
      .insert([minimalRow])
      .select();

    if (insErr) {
      console.error("Minimal insert failed:", insErr);

      // Try with additional fields
      const fullRow = {
        ...minimalRow,
        run_at: now,
        open_count: 0,
        click_count: 0,
      };

      console.log("Trying full insert:", fullRow);

      const { data: inserted2, error: insErr2 } = await supabase
        .from("automation_email_queue")
        .insert([fullRow])
        .select();

      if (insErr2) {
        return res.status(500).json({
          ok: false,
          error: "Both insert attempts failed",
          minimal_error: insErr.message,
          full_error: insErr2.message,
          minimal_code: insErr.code,
          full_code: insErr2.code,
        });
      }

      return res.json({
        ok: true,
        method: "full",
        inserted: inserted2,
      });
    }

    return res.json({
      ok: true,
      method: "minimal",
      inserted,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack,
    });
  }
}
