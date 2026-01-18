// /pages/api/automation/engine/requeue.js
// FULL REPLACEMENT (NEW FILE)
// POST { flow_id?: string, lead_id?: string, job_id?: string }
// ✅ Sets matching automation_queue rows back to pending and run_at = now
// ✅ Does NOT insert anything
// ✅ Auth: Bearer / x-cron-key / ?key=
//
// ENV required:
//  - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE)
//  - AUTOMATION_CRON_SECRET (or AUTOMATION_CRON_KEY / CRON_SECRET)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getAuthKey(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) return m[1].trim();

  const x = String(
    req.headers?.["x-cron-key"] || req.headers?.["X-Cron-Key"] || ""
  ).trim();
  if (x) return x;

  const q = String(req.query?.key || "").trim();
  if (q) return q;

  return "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST" });
    }

    const provided = getAuthKey(req);
    if (CRON_SECRET && provided !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const job_id = String(req.body?.job_id || "").trim();
    const flow_id = String(req.body?.flow_id || "").trim();
    const lead_id = String(req.body?.lead_id || "").trim();

    if (!job_id && !flow_id && !lead_id) {
      return res.status(400).json({
        ok: false,
        error: "Provide at least one: job_id, flow_id, lead_id",
      });
    }

    const nowIso = new Date().toISOString();

    let q = supabaseAdmin
      .from("automation_queue")
      .update({ status: "pending", run_at: nowIso, updated_at: nowIso });

    if (job_id) q = q.eq("id", job_id);
    if (flow_id) q = q.eq("flow_id", flow_id);
    if (lead_id) q = q.eq("lead_id", lead_id);

    const { data, error } = await q.select("id,status,run_at,next_node_id");

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({
      ok: true,
      updated: (data || []).length,
      rows: data || [],
    });
  } catch (err) {
    console.error("requeue error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
