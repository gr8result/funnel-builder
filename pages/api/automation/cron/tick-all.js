// /pages/api/automation/cron/tick-all.js
// Cron job to advance automation flows (process triggers, delays, conditions)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE ||
  "";

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "http://localhost:3000"
  );
}

function okAuth(req) {
  const secret = CRON_SECRET;
  if (!secret) return true; // dev-safe: if no secret set, allow
  
  const h = (req.headers.authorization || "").trim();
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const q = (req.query.key || "").toString().trim();
  const x = (req.headers["x-cron-key"] || "").toString().trim();
  
  return bearer === secret || q === secret || x === secret;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    if (!okAuth(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const maxFlows = Number(req.body?.maxFlows || 50);
    const maxPerFlow = Number(req.body?.maxPerFlow || 200);

    const { data: flows, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id")
      .limit(maxFlows);

    if (flowErr) {
      return res.status(500).json({ ok: false, error: flowErr.message });
    }

    const flowIds = (flows || []).map((f) => f.id).filter(Boolean);

    let processed = 0;
    for (const flowId of flowIds) {
      try {
        await fetch(`${baseUrl()}/api/automation/engine/tick`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CRON_SECRET ? { "x-cron-key": CRON_SECRET } : {}),
          },
          body: JSON.stringify({ flow_id: flowId, max: maxPerFlow }),
        });
        processed += 1;
      } catch {
        // ignore errors per-flow
      }
    }

    return res.json({ ok: true, flows: flowIds.length, processed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
