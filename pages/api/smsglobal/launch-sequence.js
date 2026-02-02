// /pages/api/smsglobal/launch-sequence.js
// FULL REPLACEMENT
//
// ✅ Supports audience.type: 'lead' | 'manual' | 'list'
// ✅ Robust lead phone picking (doesn't assume column names)
// ✅ Robust sms_queue insert (tries multiple column name variants automatically)
// ✅ Multi-tenant safe for 'lead' (checks common ownership fields)
// ✅ Uses service role for inserts
//
// UI payload supported:
//  {
//    audience: { type:'lead', lead_id } OR { type:'manual', phone } OR { type:'list', list_id },
//    steps: [{ delay, unit, message }...] (max 3)
//  }
//
// NOTE: This endpoint ENQUEUES. Your sender/worker should flush sms_queue.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

function s(v) {
  return String(v ?? "").trim();
}

function json(res, status, body) {
  return res.status(status).json(body);
}

function digitsOnly(v) {
  return s(v).replace(/[^\d]/g, "");
}

function normalizePhoneForSend(raw) {
  const t = s(raw);
  if (!t) return "";
  
  // Strip everything but digits and +
  let v = t.replace(/[^\d+]/g, "");
  if (!v) return "";
  
  // Strip leading + if present
  if (v.startsWith("+")) v = v.slice(1);
  
  // Convert 0XXXXXXXXX to 61XXXXXXXXX (AU)
  if (v.startsWith("0") && v.length >= 9) v = "61" + v.slice(1);
  
  // Ensure it starts with 61 for AU numbers without explicit country code
  if (!v.startsWith("61") && /^\d{9,}$/.test(v)) v = "61" + v;
  
  // SMSGlobal v2 API expects format without + (e.g., 61417004315)
  return v;
}

async function getUserFromBearer(req, supabaseAnon) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function pickLeadPhone(leadRow) {
  if (!leadRow || typeof leadRow !== "object") return "";

  const candidates = [
    leadRow.to_phone,
    leadRow.phone,
    leadRow.mobile,
    leadRow.mobile_phone,
    leadRow.phone_number,
    leadRow.cell,
    leadRow.cell_phone,
    leadRow.sms,
    leadRow.sms_phone,
    leadRow.contact_number,
    leadRow.contact_phone,
    leadRow.primary_phone,
    leadRow.tel,
    leadRow.telephone,
  ];

  for (const c of candidates) {
    const v = s(c);
    if (v) return v;
  }
  return "";
}

function isOwnedByUser(lead, userId) {
  if (!lead || typeof lead !== "object") return false;

  // Prefer explicit ownership fields if they exist
  const checks = [
    lead.user_id,
    lead.owner_id,
    lead.created_by,
    lead.profile_id,
    lead.account_user_id,
  ].map((x) => s(x));

  // If any of these fields exist and match, accept
  for (const v of checks) {
    if (v && v === s(userId)) return true;
  }

  // If the table doesn’t have any of those fields populated,
  // we refuse (safer than leaking / sending to other tenant)
  const hasAnyOwnershipField = checks.some((v) => v.length > 0);
  if (!hasAnyOwnershipField) return false;

  return false;
}

function unitToMinutes(unit) {
  const u = s(unit).toLowerCase();
  if (u === "days") return 24 * 60;
  if (u === "hours") return 60;
  return 1; // minutes default
}

// --- LIST MEMBERSHIP LOOKUP (tries a few common tables) ---
async function getLeadIdsForList(supabaseAdmin, listId) {
  const lid = s(listId);
  if (!lid) return [];

  const attempts = [
    { table: "lead_list_members", leadCol: "lead_id", listCol: "list_id" },
    { table: "lead_lists_members", leadCol: "lead_id", listCol: "list_id" },
    { table: "email_list_members", leadCol: "lead_id", listCol: "list_id" },
    { table: "lead_list_memberships", leadCol: "lead_id", listCol: "list_id" },
  ];

  for (const a of attempts) {
    try {
      const { data, error } = await supabaseAdmin
        .from(a.table)
        .select(a.leadCol)
        .eq(a.listCol, lid)
        .limit(50000);

      if (!error && Array.isArray(data)) {
        const ids = data.map((r) => s(r?.[a.leadCol])).filter(Boolean);
        if (ids.length) return Array.from(new Set(ids));
        return [];
      }
      // if relation missing or other error, try next
    } catch {
      // try next
    }
  }

  // If you use a different membership table, add it above.
  return [];
}

// --- SMS QUEUE INSERT (tries multiple column variants until one works) ---
function buildInsertVariants({
  user_id,
  lead_id,
  step_no,
  to_phone,
  body,
  send_at_iso,
  scheduled_for,
  available_at,
  status,
}) {
  // We will try these shapes in order until one inserts without "column does not exist" errors.
  // Your sms_queue schema has: id, user_id, lead_id, step_no, to_phone, body, scheduled_for, status, 
  // provider_message_id, error, created_at, updated_at, origin, available_at, provider_id, last_error
  return [
    // Variant A (matches your actual schema exactly)
    {
      user_id,
      lead_id,
      step_no,
      to_phone,
      body,
      scheduled_for,
      status,
      available_at,
    },
    // Variant B (with origin if provided)
    {
      user_id,
      lead_id,
      step_no,
      to_phone,
      body,
      scheduled_for,
      status,
      available_at,
      origin: null,
    },
    // Variant C (minimal - let defaults handle created_at, updated_at)
    {
      user_id,
      lead_id,
      step_no,
      to_phone,
      body,
      scheduled_for,
    },
    // Variant D (no available_at)
    {
      user_id,
      lead_id,
      step_no,
      to_phone,
      body,
      scheduled_for,
      status,
    },
  ];
}

async function insertSmsQueueRows(supabaseAdmin, baseRows) {
  // baseRows is an array of objects: { user_id, lead_id, step_no, to_phone, body, send_at_iso }
  // We try one “shape” across all rows so it’s consistent.

  if (!Array.isArray(baseRows) || !baseRows.length) {
    return { ok: true, inserted: 0, ids: [] };
  }

  // Build variants for FIRST row, then apply same shape to all rows.
  const first = baseRows[0];
  const firstVariants = buildInsertVariants(first);

  for (let i = 0; i < firstVariants.length; i++) {
    const shape = firstVariants[i];
    const keys = Object.keys(shape);

    const shapedRows = baseRows.map((r) => {
      const v = buildInsertVariants(r)[i] || {};
      // ensure only the keys for this variant
      const out = {};
      for (const k of keys) out[k] = v[k];
      return out;
    });

    const ins = await supabaseAdmin.from("sms_queue").insert(shapedRows).select("id");
    if (!ins.error) {
      return {
        ok: true,
        inserted: shapedRows.length,
        ids: (ins.data || []).map((x) => x.id),
        used_variant: i,
        used_keys: keys,
      };
    }

    // If it's a "column does not exist" type mismatch, try next variant.
    const msg = s(ins.error.message);
    const isColumnMismatch =
      msg.includes("does not exist") ||
      msg.includes("column") ||
      msg.includes("schema cache") ||
      msg.includes("Could not find") ||
      msg.includes("unknown");

    if (!isColumnMismatch) {
      // real error like RLS, not-null, etc -> stop
      return { ok: false, error: ins.error.message, detail: ins.error };
    }
  }

  return { ok: false, error: "Could not match sms_queue columns (all insert variants failed)" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json(res, 500, { ok: false, error: "Missing Supabase env" });
  }

  const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const user = await getUserFromBearer(req, supabaseAnon);
  if (!user) return json(res, 401, { ok: false, error: "Unauthorized" });

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    body = req.body || {};
  }

  const audience = body.audience || {};
  const audienceType = s(audience.type || body.audienceType || "lead").toLowerCase();

  const stepsRaw = Array.isArray(body.steps) ? body.steps : [];
  if (!stepsRaw.length) return json(res, 400, { ok: false, error: "Missing steps" });

  const steps = stepsRaw
    .map((st) => ({
      delay: Number(st.delay || 0),
      unit: s(st.unit || "minutes"),
      message: s(st.message || st.body || st.text),
    }))
    .filter((x) => x.message)
    .slice(0, 3);

  if (!steps.length) return json(res, 400, { ok: false, error: "No valid messages in steps" });

  // Build recipients [{ lead_id?, to_phone }]
  const recipients = [];

  if (audienceType === "manual") {
    const phone = normalizePhoneForSend(audience.phone || audience.to || body.phone || body.to);
    if (!phone) return json(res, 400, { ok: false, error: "Missing manual phone" });
    recipients.push({ lead_id: null, to_phone: phone });
  } else if (audienceType === "lead") {
    const lead_id = s(audience.lead_id || body.lead_id || body.leadId);
    if (!lead_id) return json(res, 400, { ok: false, error: "Missing lead_id" });

    const { data: lead, error: leadErr } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr) {
      return json(res, 500, { ok: false, error: "Lead lookup failed", detail: leadErr.message });
    }
    if (!lead) return json(res, 404, { ok: false, error: "Lead not found" });

    if (!isOwnedByUser(lead, user.id)) {
      return json(res, 403, { ok: false, error: "Not your lead" });
    }

    const phone = normalizePhoneForSend(pickLeadPhone(lead));
    if (!phone) return json(res, 400, { ok: false, error: "Lead has no phone number" });

    recipients.push({ lead_id, to_phone: phone });
  } else if (audienceType === "list") {
    const list_id = s(audience.list_id || body.list_id || body.listId);
    if (!list_id) return json(res, 400, { ok: false, error: "Missing list_id" });

    const leadIds = await getLeadIdsForList(supabaseAdmin, list_id);
    if (!leadIds.length) {
      return json(res, 400, { ok: false, error: "No leads found in this list (membership table mismatch?)" });
    }

    // Load leads in chunks
    const chunkSize = 500;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
      const chunk = leadIds.slice(i, i + chunkSize);
      const { data: leadRows, error } = await supabaseAdmin
        .from("leads")
        .select("*")
        .in("id", chunk);

      if (error) {
        return json(res, 500, { ok: false, error: "Lead batch lookup failed", detail: error.message });
      }

      for (const lead of leadRows || []) {
        if (!isOwnedByUser(lead, user.id)) continue;
        const phone = normalizePhoneForSend(pickLeadPhone(lead));
        if (!phone) continue;
        recipients.push({ lead_id: s(lead.id), to_phone: phone });
      }
    }

    if (!recipients.length) {
      return json(res, 400, { ok: false, error: "No sendable leads in list (no phones or not owned by user)" });
    }
  } else {
    return json(res, 400, { ok: false, error: "Invalid audience.type" });
  }

  // Use user_id as origin (immutable, unique per user)
  const smsOrigin = user.id;

  // Build sms_queue rows with correct delays per lead (each lead gets their own schedule)
  const now = Date.now();
  const baseRows = [];
  for (const r of recipients) {
    let cumulativeMinutes = 0;
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const st = steps[stepIndex];
      const addMinutes = Math.max(0, Number(st.delay || 0)) * unitToMinutes(st.unit);
      cumulativeMinutes += addMinutes;
      const sendAtMs = now + cumulativeMinutes * 60 * 1000;
      const send_at_iso = new Date(sendAtMs).toISOString();
      baseRows.push({
        user_id: user.id,
        lead_id: r.lead_id,
        step_no: stepIndex + 1,
        to_phone: r.to_phone,
        body: st.message,
        send_at_iso,
        scheduled_for: send_at_iso,
        available_at: new Date(now).toISOString(),
        status: "queued",
        origin: smsOrigin,
      });
    }
  }

  const ins = await insertSmsQueueRows(supabaseAdmin, baseRows);
  if (!ins.ok) {
    return json(res, 500, {
      ok: false,
      error: "Failed to enqueue sms_queue rows",
      detail: ins.error || ins,
      message: typeof ins?.error === "string" ? ins.error : ins?.error?.message,
    });
  }

  // Auto-flush queued SMS after queueing (like automation does for emails)
  let flushResult = null;
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const cronKey = process.env.CRON_SECRET || process.env.AUTOMATION_CRON_KEY || '';
    
    // Always try to flush - endpoint handles auth (dev mode allows no key)
    const flushUrl = cronKey 
      ? `${siteUrl}/api/smsglobal/flush-queue?key=${encodeURIComponent(cronKey)}&limit=50`
      : `${siteUrl}/api/smsglobal/flush-queue?limit=50`;
    
    const flushResponse = await fetch(flushUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    flushResult = await flushResponse.json();
  } catch (flushErr) {
    // Flush error doesn't fail the response, just log it
    console.error('Auto-flush SMS failed:', flushErr?.message || flushErr);
  }

  return json(res, 200, {
    ok: true,
    recipients: recipients.length,
    steps: steps.length,
    queued: baseRows.length,
    inserted_ids: ins.ids || [],
    used_variant: ins.used_variant,
    used_keys: ins.used_keys,
    auto_flush: flushResult?.ok ? { sent: flushResult?.debug?.sent || 0 } : { error: 'no flush' },
  });
}
