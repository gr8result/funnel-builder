// /pages/api/automation/members/add-list.js
// FULL REPLACEMENT
//
<<<<<<< HEAD
// ✅ Correct ownership check:
//    - automation_flows.user_id is accounts.id
//    - request user is auth.users.id
//    - so we map auth uid -> accounts.id and compare to flow.user_id
//
// ✅ Correct list membership source:
//    - Imports leads via public.lead_list_members (NOT leads.list_id, NOT email_list_members)
//
// ✅ Inserts automation_flow_members with:
//    - user_id = auth uid (matches your automation_flow_members schema)
//    - flow_id, lead_id
//
// ✅ Idempotent via upsert on (flow_id, lead_id)
=======
// ✅ Imports automation members from *public.leads.list_id* (NOT lead_list_members)
// ✅ Multi-tenant safe (user must own the flow + leads)
// ✅ Idempotent: won't duplicate members if run multiple times
//
// Expects JSON body:
//  { "flow_id": "<uuid>", "list_id": "<uuid>" }
//
// Requires env:
//  NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY / SUPABASE_SERVICE)
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

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
<<<<<<< HEAD

const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
=======
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function getBearer(req) {
  const auth = String(req.headers.authorization || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

export default async function handler(req, res) {
<<<<<<< HEAD
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
=======
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res
      .status(500)
      .json({ ok: false, error: "Missing SUPABASE_URL or SERVICE KEY env" });
  }

  const token = getBearer(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing Bearer token" });
  }
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

<<<<<<< HEAD
  // Authenticated client to read the current user
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
=======
  // Identify the current user from the Bearer token
  const supabaseUser = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "", {
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
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
<<<<<<< HEAD
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
=======
    // Confirm flow belongs to this user
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,name")
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
      .eq("id", flow_id)
      .maybeSingle();

    if (flowErr) throw flowErr;
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found" });

<<<<<<< HEAD
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

    // 3) Pull lead_ids from lead_list_members for this list
    // and join to leads to ensure the leads belong to the same auth user.
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("lead_list_members")
      .select("lead_id, leads!inner(id,user_id)")
      .eq("list_id", list_id)
      .eq("leads.user_id", user.id)
      .limit(10000);

    if (rowsErr) throw rowsErr;

    const leadIds = (rows || []).map((r) => r.lead_id).filter(Boolean);

    if (!leadIds.length) {
      return res.json({
        ok: true,
        flow_id,
        list_id,
        imported: 0,
        skipped: 0,
        message: "No leads found in that list for this user (lead_list_members -> leads.user_id).",
      });
    }

    // 4) Upsert into automation_flow_members (your table requires user_id, flow_id, lead_id)
    // NOTE: this requires a UNIQUE constraint on (flow_id, lead_id) for onConflict to work properly.
    const now = new Date().toISOString();
    const payload = leadIds.map((lead_id) => ({
      user_id: user.id, // auth uid
      flow_id,
      lead_id,
      status: "active",
      source: "list_import",
      created_at: now,
      updated_at: now,
    }));

    const { error: upErr } = await supabaseAdmin
      .from("automation_flow_members")
      .upsert(payload, { onConflict: "flow_id,lead_id" });

    if (upErr) throw upErr;
=======
    if (String(flow.user_id) !== String(user.id)) {
      return res.status(403).json({ ok: false, error: "Not allowed for this flow" });
    }

    // Pull leads from leads.list_id (the authoritative source for NOW)
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

    // Insert into automation_flow_members
    // Expected columns: flow_id, lead_id, status, created_at
    // If your table uses user_id too, we add it safely.
    let imported = 0;
    let skipped = 0;

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

      const { error: insErr } = await supabaseAdmin.from("automation_flow_members").insert({
        flow_id,
        lead_id: leadId,
        status: "active",
        created_at: new Date().toISOString(),
        user_id: user.id, // harmless if column exists; if not, remove this line
      });

      if (insErr) {
        // If user_id column doesn't exist, retry without it (one-time fallback)
        if (String(insErr.message || "").toLowerCase().includes("user_id")) {
          const { error: ins2Err } = await supabaseAdmin.from("automation_flow_members").insert({
            flow_id,
            lead_id: leadId,
            status: "active",
            created_at: new Date().toISOString(),
          });
          if (ins2Err) throw ins2Err;
        } else {
          throw insErr;
        }
      }

      imported++;
    }
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

    return res.json({
      ok: true,
      flow_id,
      list_id,
<<<<<<< HEAD
      imported: leadIds.length,
      skipped: 0,
      note: "Upsert used (duplicates automatically ignored).",
=======
      imported,
      skipped,
      total_in_list: leadIds.length,
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
