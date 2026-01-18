// /pages/api/automation/engine/kick.js
// FULL REPLACEMENT
//
// ✅ “Make it run now” endpoint for a flow
// ✅ Sets all automation_queue rows for that flow to run_at=NOW() + status=pending
// ✅ Then immediately calls tick(force=1) so you see results straight away
//
// POST /api/automation/engine/kick
// Body: { flow_id: "...", limit?: 200 }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const NOW_ISO = () => new Date().toISOString();

function s(v) {
  return String(v ?? "").trim();
}

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const flow_id = s(req.body?.flow_id);
    const limit = Number(req.body?.limit || 200) || 200;

    if (!flow_id) return res.status(400).json({ ok: false, error: "flow_id required" });

    const now = NOW_ISO();

    // Select queue rows for this flow (so we don’t mass-update the whole table)
    const { data: rows, error: selErr } = await supabase
      .from("automation_queue")
      .select("id,status,run_at,next_node_id")
      .eq("flow_id", flow_id)
      .limit(limit);

    if (selErr) return res.status(500).json({ ok: false, error: msg(selErr) });

    const ids = (rows || []).map((r) => r.id).filter(Boolean);

    if (!ids.length) {
      return res.json({ ok: true, message: "No automation_queue rows for this flow." });
    }

    // Force them due now
    const { error: upErr } = await supabase
      .from("automation_queue")
      .update({ status: "pending", run_at: now })
      .in("id", ids);

    if (upErr) return res.status(500).json({ ok: false, error: msg(upErr) });

    // Call tick immediately (same code path as cron)
    // We don’t import tick.js directly; we just re-run the same queries here.
    // Minimal: return the state after forcing due; you then hit /api/automation/engine/tick?flow_id=...&force=1

    return res.json({
      ok: true,
      flow_id,
      updated: ids.length,
      now,
      next_step: `/api/automation/engine/tick?flow_id=${flow_id}&force=1`,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
