// /pages/api/automation/members/add-list.js
// FULL REPLACEMENT
//
// ✅ Imports list members into automation_flow_members
// ✅ ALSO creates/ensures automation_flow_runs so the engine can actually PROCESS after import
// ✅ Works with your real tables shown:
//    - automation_flow_members (user_id, flow_id, lead_id, status, source, created_at, updated_at) UNIQUE(flow_id,lead_id)
//    - automation_flow_runs    (user_id, flow_id, lead_id, current_node_id, status, available_at, source, last_error, created_at, updated_at)
// ✅ Handles list member schema drift (email_list_members + list_id, etc.)
// ✅ Returns hard debug

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const NOW = () => new Date().toISOString();

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function isMissing(err) {
  const code = String(err?.code || "");
  const m = msg(err).toLowerCase();
  return (
    code === "42P01" || // undefined_table
    code === "42703" || // undefined_column
    m.includes("does not exist") ||
    m.includes("undefined column") ||
    m.includes("relation") ||
    m.includes("column")
  );
}

async function hasColumn(table, col) {
  const { error } = await supabaseAdmin.from(table).select(col).limit(1);
  if (!error) return true;
  if (isMissing(error)) return false;
  return false;
}

async function getAuthUserId(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7);
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (!error && data?.user?.id) return data.user.id;
  }
  return req.body?.user_id || null;
}

async function getAccountIdForUser(user_id) {
  if (!user_id) return null;
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id")
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) return null;
  return data?.id || null;
}

function ownerSet(auth_user_id, account_id) {
  const s = new Set();
  if (auth_user_id) s.add(auth_user_id);
  if (account_id) s.add(account_id);
  return s;
}

/** Try selecting flow with account_id and user_id, but tolerate missing columns */
async function loadFlow(flow_id) {
  {
    const r = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,account_id")
      .eq("id", flow_id)
      .maybeSingle();

    if (!r.error) return { ok: true, flow: r.data, mode: "id,user_id,account_id" };
    if (!isMissing(r.error)) return { ok: false, error: r.error };
  }

  {
    const r = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id")
      .eq("id", flow_id)
      .maybeSingle();

    if (!r.error) return { ok: true, flow: r.data, mode: "id,user_id" };
    return { ok: false, error: r.error };
  }
}

async function findListRecord({ list_id, owners, debug }) {
  const listTables = ["email_lists", "lead_lists"];

  for (const table of listTables) {
    {
      const r = await supabaseAdmin
        .from(table)
        .select("id,name,user_id")
        .eq("id", list_id)
        .maybeSingle();

      debug.listChecks.push({
        table,
        select: "id,name,user_id",
        found: !!r.data?.id,
        error: r.error ? msg(r.error) : null,
      });

      if (!r.error && r.data?.id) {
        const owner = r.data.user_id;
        if (owner && !owners.has(owner)) return { ok: false, reason: "wrong_owner", table };
        return { ok: true, table, list: r.data };
      }

      if (r.error && isMissing(r.error)) {
        const r2 = await supabaseAdmin
          .from(table)
          .select("id,name")
          .eq("id", list_id)
          .maybeSingle();

        debug.listChecks.push({
          table,
          select: "id,name",
          found: !!r2.data?.id,
          error: r2.error ? msg(r2.error) : null,
        });

        if (!r2.error && r2.data?.id) return { ok: true, table, list: r2.data };
      }
    }
  }

  return { ok: false, reason: "not_found" };
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function extractLeadIdsOrEmails(rows, debug) {
  const leadIds = [];
  const emails = [];

  const leadIdKeys = [
    "lead_id",
    "leadId",
    "lead_uuid",
    "leadUuid",
    "contact_id",
    "contactId",
    "contact_uuid",
    "contactUuid",
    "person_id",
    "personId",
    "member_id",
    "memberId",
    "subscriber_id",
    "subscriberId",
    "customer_id",
    "customerId",
  ];

  const emailKeys = [
    "email",
    "email_address",
    "emailAddress",
    "lead_email",
    "leadEmail",
    "contact_email",
    "contactEmail",
    "subscriber_email",
    "subscriberEmail",
  ];

  for (const r of rows || []) {
    let lid = null;
    for (const k of leadIdKeys) {
      if (r && r[k]) {
        lid = r[k];
        break;
      }
    }
    if (lid) leadIds.push(lid);

    let em = "";
    for (const k of emailKeys) {
      if (r && r[k]) {
        em = normalizeEmail(r[k]);
        break;
      }
    }
    if (em) emails.push(em);
  }

  const out = {
    leadIds: leadIds.filter(Boolean),
    emails: [...new Set(emails.filter(Boolean))],
  };

  debug.extract = { directLeadIds: out.leadIds.length, emails: out.emails.length };
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildIlikeOr(col, values) {
  return values
    .map((v) => `${col}.ilike.${String(v).replace(/,/g, "")}`)
    .join(",");
}

async function detectLeadsEmailColumn(debug) {
  const hasEmail = await hasColumn("leads", "email");
  if (hasEmail) {
    debug.leadsEmailCol = "email";
    return "email";
  }
  const hasEmailAddress = await hasColumn("leads", "email_address");
  if (hasEmailAddress) {
    debug.leadsEmailCol = "email_address";
    return "email_address";
  }
  debug.leadsEmailCol = "email";
  return "email";
}

async function resolveEmailsToLeadIds({ emails, owners, debug }) {
  if (!emails?.length) return [];
  const emailCol = await detectLeadsEmailColumn(debug);

  // IN + owner (fast path)
  for (const owner of owners) {
    const r = await supabaseAdmin
      .from("leads")
      .select(`id,${emailCol},user_id`)
      .in(emailCol, emails)
      .eq("user_id", owner);

    debug.leadResolveChecks.push({
      mode: "IN + owner(user_id)",
      owner,
      emailCol,
      rows: Array.isArray(r.data) ? r.data.length : 0,
      error: r.error ? msg(r.error) : null,
    });

    if (!r.error && Array.isArray(r.data) && r.data.length) {
      return r.data.map((x) => x.id).filter(Boolean);
    }

    if (r.error && isMissing(r.error)) break;
  }

  // IN without owner
  {
    const r2 = await supabaseAdmin
      .from("leads")
      .select(`id,${emailCol}`)
      .in(emailCol, emails);

    debug.leadResolveChecks.push({
      mode: "IN (no owner)",
      emailCol,
      rows: Array.isArray(r2.data) ? r2.data.length : 0,
      error: r2.error ? msg(r2.error) : null,
    });

    if (!r2.error && Array.isArray(r2.data) && r2.data.length) {
      return r2.data.map((x) => x.id).filter(Boolean);
    }
  }

  // ILIKE OR chunks (case-insensitive exact)
  const chunks = chunk(emails, 25);

  for (const owner of owners) {
    for (const c of chunks) {
      const orStr = buildIlikeOr(emailCol, c);
      const r = await supabaseAdmin
        .from("leads")
        .select(`id,${emailCol},user_id`)
        .or(orStr)
        .eq("user_id", owner);

      debug.leadResolveChecks.push({
        mode: "ILIKE OR chunk + owner(user_id)",
        owner,
        emailCol,
        chunk: c.length,
        rows: Array.isArray(r.data) ? r.data.length : 0,
        error: r.error ? msg(r.error) : null,
      });

      if (!r.error && Array.isArray(r.data) && r.data.length) {
        return r.data.map((x) => x.id).filter(Boolean);
      }

      if (r.error && isMissing(r.error)) break;
    }
  }

  for (const c of chunks) {
    const orStr = buildIlikeOr(emailCol, c);
    const r = await supabaseAdmin
      .from("leads")
      .select(`id,${emailCol}`)
      .or(orStr);

    debug.leadResolveChecks.push({
      mode: "ILIKE OR chunk (no owner)",
      emailCol,
      chunk: c.length,
      rows: Array.isArray(r.data) ? r.data.length : 0,
      error: r.error ? msg(r.error) : null,
    });

    if (!r.error && Array.isArray(r.data) && r.data.length) {
      return r.data.map((x) => x.id).filter(Boolean);
    }
  }

  return [];
}

async function loadMemberRows({ list_id, debug }) {
  // IMPORTANT: your debug proved lead_list_members does NOT exist in schema cache,
  // and email_list_members exists and uses list_id.
  // We still probe safely.
  const candidates = [
    { table: "email_list_members", fks: ["list_id", "email_list_id"] },
    { table: "lead_list_members", fks: ["list_id", "lead_list_id"] },
    { table: "list_members", fks: ["list_id", "lead_list_id", "email_list_id"] },
    { table: "lead_list_subscribers", fks: ["list_id", "lead_list_id"] },
    { table: "email_list_subscribers", fks: ["list_id", "email_list_id"] },
  ];

  for (const c of candidates) {
    for (const fk of c.fks) {
      const r = await supabaseAdmin.from(c.table).select("*").eq(fk, list_id);

      debug.memberChecks.push({
        table: c.table,
        fk,
        rows: Array.isArray(r.data) ? r.data.length : 0,
        error: r.error ? msg(r.error) : null,
      });

      if (!r.error) {
        const rows = Array.isArray(r.data) ? r.data : [];
        const sample = rows.slice(0, 3);
        debug.memberWinning = { table: c.table, fk, rows: rows.length };
        debug.memberRowSample = sample;
        debug.memberRowKeys = sample[0] ? Object.keys(sample[0]) : [];
        return { ok: true, table: c.table, fk, rows };
      }
    }
  }

  return { ok: false, table: null, fk: null, rows: [] };
}

/**
 * Insert memberships using the REAL schema you showed.
 * automation_flow_members requires user_id + flow_id + lead_id (NOT NULL).
 */
async function upsertMembers({ flow_id, leadIds, auth_user_id, debug }) {
  const now = NOW();

  // Dedup: only insert those not already in table for this flow
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("automation_flow_members")
    .select("lead_id,status")
    .eq("flow_id", flow_id)
    .in("lead_id", leadIds);

  if (exErr) return { ok: false, error: msg(exErr) };

  const existingMap = new Map((existing || []).map((r) => [r.lead_id, r.status]));
  const toInsert = [];
  const toReactivate = [];

  for (const lid of leadIds) {
    const s = existingMap.get(lid);
    if (!s) toInsert.push(lid);
    else if (String(s).toLowerCase() !== "active") toReactivate.push(lid);
  }

  debug.membersPlan = {
    leadIds: leadIds.length,
    toInsert: toInsert.length,
    toReactivate: toReactivate.length,
    alreadyActive: leadIds.length - toInsert.length - toReactivate.length,
  };

  if (toInsert.length) {
    const payload = toInsert.map((lead_id) => ({
      user_id: auth_user_id,
      flow_id,
      lead_id,
      status: "active",
      source: "list_import",
      created_at: now,
      updated_at: now,
    }));

    const { error } = await supabaseAdmin.from("automation_flow_members").insert(payload);
    if (error) return { ok: false, error: msg(error) };
  }

  let reactivated = 0;
  if (toReactivate.length) {
    const { error } = await supabaseAdmin
      .from("automation_flow_members")
      .update({ status: "active", updated_at: now })
      .eq("flow_id", flow_id)
      .in("lead_id", toReactivate);

    if (!error) reactivated = toReactivate.length;
    else debug.memberReactivateError = msg(error);
  }

  return {
    ok: true,
    inserted: toInsert.length,
    existing: (existing || []).length,
    reactivated,
    total: toInsert.length + (existing || []).length,
    toInsert,
    toReactivate,
  };
}

/**
 * CRITICAL FIX:
 * Create/ensure runs so the engine actually advances from Trigger -> Email.
 * automation_flow_runs: (user_id, flow_id, lead_id, status, available_at, current_node_id)
 */
async function ensureRuns({ flow_id, leadIds, auth_user_id, debug }) {
  const now = NOW();

  // Read existing active runs
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("automation_flow_runs")
    .select("id,lead_id,status")
    .eq("flow_id", flow_id)
    .in("lead_id", leadIds)
    .in("status", ["active"]); // keep simple

  debug.runEnsure = debug.runEnsure || {};
  if (exErr) {
    debug.runEnsure.error = msg(exErr);
    // don't fail the whole import if runs table has an issue
    return { ok: false, error: msg(exErr) };
  }

  const haveActive = new Set((existing || []).map((r) => r.lead_id));
  const toCreate = leadIds.filter((id) => !haveActive.has(id));

  // If there are older runs in non-active statuses, we can just create new ones (or you can reactivate later)
  if (!toCreate.length) {
    debug.runEnsure = { existingActive: (existing || []).length, created: 0 };
    return { ok: true, created: 0 };
  }

  const payload = toCreate.map((lead_id) => ({
    user_id: auth_user_id,
    flow_id,
    lead_id,
    current_node_id: null, // start at trigger
    status: "active",
    available_at: now,
    source: "list_import",
    last_error: null,
    created_at: now,
    updated_at: now,
  }));

  const { error: insErr } = await supabaseAdmin.from("automation_flow_runs").insert(payload);

  if (insErr) {
    debug.runEnsure = { existingActive: (existing || []).length, createAttempt: payload.length, error: msg(insErr) };
    return { ok: false, error: msg(insErr) };
  }

  debug.runEnsure = { existingActive: (existing || []).length, created: payload.length };
  return { ok: true, created: payload.length };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const debug = {
    flowSelectMode: null,
    auth_user_id: null,
    account_id: null,
    owners: [],
    flowOwner: null,
    listChecks: [],
    memberChecks: [],
    memberWinning: null,
    memberRowKeys: [],
    memberRowSample: [],
    extract: null,
    leadsEmailCol: null,
    leadResolveChecks: [],
    membersPlan: null,
    runEnsure: null,
  };

  try {
    const flow_id = String(req.body?.flow_id || "").trim();
    const list_id = String(req.body?.list_id || "").trim();

    if (!flow_id || !list_id) {
      return res.status(400).json({ ok: false, error: "flow_id and list_id required" });
    }

    const auth_user_id = await getAuthUserId(req);
    debug.auth_user_id = auth_user_id;
    if (!auth_user_id) return res.status(401).json({ ok: false, error: "Missing/invalid auth", debug });

    const account_id = await getAccountIdForUser(auth_user_id);
    debug.account_id = account_id;

    const owners = ownerSet(auth_user_id, account_id);
    debug.owners = [...owners];

    const lf = await loadFlow(flow_id);
    if (!lf.ok) return res.status(500).json({ ok: false, error: msg(lf.error), debug });
    debug.flowSelectMode = lf.mode;

    const flow = lf.flow;
    if (!flow?.id) return res.status(404).json({ ok: false, error: "Flow not found", debug });

    const flowOwner = flow.account_id || flow.user_id || null;
    debug.flowOwner = flowOwner;

    if (flowOwner && !owners.has(flowOwner)) {
      return res.status(403).json({ ok: false, error: "Not allowed for this flow", debug });
    }

    const listLookup = await findListRecord({ list_id, owners, debug });
    if (!listLookup.ok) {
      return res.status(404).json({
        ok: false,
        error: listLookup.reason === "wrong_owner" ? "List belongs to a different owner" : "List not found",
        debug,
      });
    }

    const memberLoad = await loadMemberRows({ list_id, debug });
    if (!memberLoad.ok) {
      return res.status(500).json({
        ok: false,
        error: "Could not read list members (membership table/column mismatch)",
        debug,
      });
    }

    const { leadIds: directLeadIds, emails } = extractLeadIdsOrEmails(memberLoad.rows, debug);

    let leadIds = [...new Set((directLeadIds || []).filter(Boolean))];
    if (!leadIds.length && emails.length) {
      const resolved = await resolveEmailsToLeadIds({ emails, owners, debug });
      leadIds = [...new Set((resolved || []).filter(Boolean))];
    }

    if (!leadIds.length) {
      return res.json({
        ok: true,
        inserted: 0,
        existing: 0,
        reactivated: 0,
        total: 0,
        runs_created: 0,
        message: "List has no resolvable members (no lead_id matched and email resolve found 0).",
        debug,
      });
    }

    // 1) Upsert membership rows (REAL schema)
    const mem = await upsertMembers({ flow_id, leadIds, auth_user_id, debug });
    if (!mem.ok) return res.status(500).json({ ok: false, error: mem.error, debug });

    // 2) CRITICAL: Ensure runs exist so engine can advance
    // We ensure runs for ALL leadIds (inserted + existing), because you might import into a flow that had members already but no runs.
    const runs = await ensureRuns({ flow_id, leadIds, auth_user_id, debug });

    return res.json({
      ok: true,
      inserted: mem.inserted,
      existing: mem.existing,
      reactivated: mem.reactivated,
      total: mem.total,
      runs_created: runs?.created || 0,
      debug,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e), debug });
  }
}
