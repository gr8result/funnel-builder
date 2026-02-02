// /pages/api/automation/members/add-list.js
// FULL REPLACEMENT — same import logic, but FIXES tick URL so it always hits correct host/port
//
// ✅ Imports members from leads.list_id
// ✅ Multi-tenant safe
// ✅ Idempotent (no dupes)
// ✅ After import, calls /api/automation/engine/tick on SAME host/port that received this request
// ✅ Uses cron secret header if present (optional)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const SERVICE_KEY =
  (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE ||
    ""
  ).trim();

const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function getBearer(req) {
  const auth = String(req.headers.authorization || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

function getBaseUrlFromReq(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000");
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing env",
      need: [
        "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)",
        "SUPABASE_SERVICE_ROLE_KEY (or variants)",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ],
    });
  }

  const token = getBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseUser.auth.getUser();

  if (userErr || !user?.id) {
    return res.status(401).json({ ok: false, error: "Invalid session", detail: msg(userErr) });
  }

  const flow_id = String(req.body?.flow_id || "").trim();
  const list_id = String(req.body?.list_id || "").trim();
  if (!flow_id || !list_id) {
    return res.status(400).json({
      ok: false,
      error: "flow_id and list_id are required",
      got: { flow_id: !!flow_id, list_id: !!list_id },
    });
  }

  try {
    // Resolve account_id for auth user
    const { data: acct, error: acctErr } = await supabaseAdmin
      .from("accounts")
      .select("id,user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (acctErr) throw acctErr;
    const account_id = acct?.id || null;

    // Load flow owner
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,name,is_standard")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr) throw flowErr;
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found" });

    const owned =
      flow.is_standard === true ||
      (account_id && String(flow.user_id) === String(account_id)) ||
      String(flow.user_id) === String(user.id);

    if (!owned) {
      return res.status(403).json({
        ok: false,
        error: "Not allowed for this flow",
        debug: { flow_owner: flow.user_id, account_id, auth_user_id: user.id },
      });
    }

    // Pull leads from leads.list_id
    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from("leads")
      .select("id,user_id,list_id")
      .eq("user_id", user.id)
      .eq("list_id", list_id)
      .limit(5000);

    if (leadsErr) throw leadsErr;

    const leadIds = (leads || []).map((l) => l.id).filter(Boolean);

    if (leadIds.length === 0) {
      return res.json({
        ok: true,
        imported: 0,
        skipped: 0,
        message: "No leads found in that list (using leads.list_id).",
      });
    }

    let imported = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const leadId of leadIds) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("automation_flow_members")
        .select("id,status")
        .eq("flow_id", flow_id)
        .eq("lead_id", leadId)
        .maybeSingle();

      if (exErr) throw exErr;

      if (existing?.id) {
        // Reactivate if status is not already active
        if (existing.status !== "active") {
          const { error: upErr } = await supabaseAdmin
            .from("automation_flow_members")
            .update({ status: "active", updated_at: now })
            .eq("id", existing.id);
          if (upErr) throw upErr;
        }
        // Count as imported even if already existed (reactivation counts)
        imported++;
        continue;
      }

      const { error: insErr } = await supabaseAdmin.from("automation_flow_members").insert({
        flow_id,
        lead_id: leadId,
        user_id: user.id,
        status: "active",
        source: "list_import",
        created_at: now,
        updated_at: now,
      });

      if (insErr) {
        // Retry without user_id if column doesn’t exist
        if (String(insErr.message || "").toLowerCase().includes("user_id")) {
          const { error: ins2Err } = await supabaseAdmin.from("automation_flow_members").insert({
            flow_id,
            lead_id: leadId,
            status: "active",
            source: "list_import",
            created_at: now,
            updated_at: now,
          });
          if (ins2Err) throw ins2Err;
        } else {
          throw insErr;
        }
      }

      imported++;
    }

    // Trigger tick on SAME host/port (fixes localhost:3000 vs 3002 problem)
    if (imported > 0) {
      const cron_secret =
        process.env.AUTOMATION_CRON_SECRET ||
        process.env.AUTOMATION_CRON_KEY ||
        process.env.CRON_SECRET ||
        "";

      const baseUrl = getBaseUrlFromReq(req);
      const tickUrl = `${baseUrl}/api/automation/engine/tick`;

      // fire-and-forget
      fetch(tickUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cron_secret ? { "x-cron-key": String(cron_secret) } : {}),
          // we also pass user bearer so it works even if cron secret is missing
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ flow_id, arm: "yes", max: 100 }),
      }).catch(() => {});
    }

    return res.json({
      ok: true,
      flow_id,
      list_id,
      inserted: imported,
      imported,
      existing: skipped,
      total_in_list: leadIds.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
