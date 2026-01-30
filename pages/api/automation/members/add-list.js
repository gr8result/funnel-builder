// /pages/api/automation/members/add-list.js
// FULL REPLACEMENT — combines best of both approaches
//
// ✅ Imports automation members from leads.list_id (authoritative source)
// ✅ Multi-tenant safe (user must own the flow + leads)
// ✅ Correct ownership check: maps auth uid -> accounts.id and compares to flow.user_id
// ✅ Idempotent: won't duplicate members, handles user_id column gracefully
//
// Expects JSON body:
//  { "flow_id": "<uuid>", "list_id": "<uuid>" }
//
// Requires env:
//  NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY / SUPABASE_SERVICE)
//  NEXT_PUBLIC_SUPABASE_ANON_KEY

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

  // Authenticated client to read the current user
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
    // 1) Resolve account_id for this auth user (accounts.id)
    const { data: acct, error: acctErr } = await supabaseAdmin
      .from("accounts")
      .select("id,user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (acctErr) throw acctErr;
    const account_id = acct?.id || null;

    // 2) Load flow owner (flow.user_id = accounts.id)
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,name,is_standard")
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr) throw flowErr;
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found" });

    // Allow standard flows, otherwise require ownership match
    const owned =
      flow.is_standard === true ||
      (account_id && String(flow.user_id) === String(account_id)) ||
      // legacy tolerance (if any old flows store auth uid)
      String(flow.user_id) === String(user.id);

    if (!owned) {
      return res.status(403).json({
        ok: false,
        error: "Not allowed for this flow",
        debug: { flow_owner: flow.user_id, account_id, auth_user_id: user.id },
      });
    }

    // 3) Pull leads from leads.list_id (the authoritative source)
    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from("leads")
      .select("id,user_id,email,name,list_id")
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

    // 4) Insert into automation_flow_members with graceful user_id handling
    let imported = 0;
    let skipped = 0;

    const now = new Date().toISOString();

    for (const leadId of leadIds) {
      // Check if already exists
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("automation_flow_members")
        .select("id")
        .eq("flow_id", flow_id)
        .eq("lead_id", leadId)
        .maybeSingle();

      if (exErr) throw exErr;

      if (existing?.id) {
        skipped++;
        continue;
      }

      // Try insert with user_id first (preferred)
      // Use the auth user_id for consistency with other endpoints
      const { error: insErr } = await supabaseAdmin.from("automation_flow_members").insert({
        flow_id,
        lead_id: leadId,
        user_id: user.id, // Use auth user_id
        status: "active",
        source: "list_import",
        created_at: now,
        updated_at: now,
      });

      if (insErr) {
        // If user_id column doesn't exist or causes issues, retry without it
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

    // 5) Automatically trigger the automation engine to start processing these new members
    if (imported > 0) {
      try {
        const tickUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/automation/engine/tick`;
        const cron_secret = process.env.AUTOMATION_CRON_SECRET || process.env.AUTOMATION_CRON_KEY || process.env.CRON_SECRET || "";
        
        // Fire and forget - don't block the response
        fetch(tickUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-key": cron_secret,
          },
          body: JSON.stringify({ flow_id, arm: "yes", max: 100 }),
        }).catch((err) => console.error("Auto-tick failed:", err));
      } catch (tickErr) {
        console.error("Failed to trigger automation:", tickErr);
        // Don't fail the response - import was successful
      }
    }

    return res.json({
      ok: true,
      flow_id,
      list_id,
      inserted: imported,
      imported,
      reactivated: imported, // Show number of newly activated/imported members
      existing: skipped,
      total: leadIds.length,
      total_in_list: leadIds.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
