// /pages/api/automation/cron/tick-all.js
// FULL REPLACEMENT
//
// ✅ Calls /api/automation/engine/tick for each flow
// ✅ Does NOT swallow errors silently
// ✅ Only increments processed if tick returns ok:true
//
// POST body: { maxFlows?:50, maxPerFlow?:200 }

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

function baseUrl(req) {
  // Prefer env, but fallback to request host (works in dev)
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.APP_URL ||
    process.env.BASE_URL ||
    "";

  if (env) return env;

  const proto = String(req.headers["x-forwarded-proto"] || "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000");
  return `${proto}://${host}`;
}

function okAuth(req) {
  if (!CRON_SECRET) return true;
  const x = String(req.headers["x-cron-key"] || "").trim();
  const q = String(req.query.key || "").trim();
  const h = String(req.headers.authorization || "").trim();
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  return x === CRON_SECRET || q === CRON_SECRET || bearer === CRON_SECRET;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    if (!okAuth(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const maxFlows = Number(req.body?.maxFlows || 50);
    const maxPerFlow = Number(req.body?.maxPerFlow || 200);

    const { data: flows, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id")
      .limit(maxFlows);

    if (flowErr) return res.status(500).json({ ok: false, error: flowErr.message });

    const flowIds = (flows || []).map((f) => f.id).filter(Boolean);

    const failures = [];
    let processed = 0;

    for (const flowId of flowIds) {
      const url = `${baseUrl(req)}/api/automation/engine/tick`;
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CRON_SECRET ? { "x-cron-key": CRON_SECRET } : {}),
          },
          body: JSON.stringify({ flow_id: flowId, max: maxPerFlow }),
        });

        const json = await resp.json().catch(() => null);

        if (resp.ok && json?.ok) {
          processed += 1;
        } else {
          failures.push({
            flow_id: flowId,
            status: resp.status,
            error: json?.error || "tick failed",
            debug: json?.debug || json || null,
          });
        }
      } catch (e) {
        failures.push({ flow_id: flowId, status: 0, error: e?.message || String(e) });
      }
    }

    return res.json({
      ok: true,
      flows: flowIds.length,
      processed,
      failed: failures.length,
      failures,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
