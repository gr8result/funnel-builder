// /pages/api/smsglobal/launch-sequence.js
// FULL REPLACEMENT — queues up to 3 SMS steps into sms_queue
//
// Accepts UI payload:
// { audience:{type:"manual|lead|list", phone?, lead_id?, list_id?}, steps:[{delay,unit,message}] }
//
// ✅ Extracts lead phone from many possible fields (selects *)
// ✅ Inserts ONLY real columns for your public.sms_queue:
//    user_id, lead_id, step_no, to_phone, body, scheduled_for
// ✅ Returns the exact insert error if it fails

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

function json(res, status, payload) {
  res.status(status).json(payload);
}

function getBearer(req) {
  const h = String(req.headers.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function s(v) {
  return String(v ?? "").trim();
}

function normalizeToMsisdnDigits(raw) {
  let v = s(raw);
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("0")) v = "61" + v.slice(1);
  v = v.replace(/[^\d]/g, "");
  return v;
}

function addDelay(baseDate, delayValue, delayUnit) {
  const d = new Date(baseDate);
  const n = Number(delayValue || 0);
  const unit = s(delayUnit || "minutes").toLowerCase();
  if (unit.startsWith("hour")) d.setHours(d.getHours() + n);
  else if (unit.startsWith("day")) d.setDate(d.getDate() + n);
  else d.setMinutes(d.getMinutes() + n);
  return d.toISOString();
}

function pickLeadPhoneDigits(leadRow) {
  if (!leadRow || typeof leadRow !== "object") return "";

  const candidates = [
    leadRow.mobile,
    leadRow.phone,
    leadRow.phone_number,
    leadRow.mobile_number,
    leadRow.mobile_phone,
    leadRow.cell,
    leadRow.cell_phone,
    leadRow.contact_number,
    leadRow.to_phone,
    leadRow.to,
    leadRow.telephone,
    leadRow.tel,
  ]
    .map((x) => s(x))
    .filter(Boolean);

  for (const c of candidates) {
    const d = normalizeToMsisdnDigits(c);
    if (d) return d;
  }
  return "";
}

async function getLeadPhoneDigits(supabaseAdmin, leadId) {
  if (!leadId) return "";
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return "";
  return pickLeadPhoneDigits(data);
}

async function getLeadIdsForList(supabaseAdmin, listId) {
  if (!listId) return [];

  const candidates = [
    { table: "lead_list_members", listCol: "list_id", leadCol: "lead_id" },
    { table: "lead_list_leads", listCol: "list_id", leadCol: "lead_id" },
    { table: "email_list_members", listCol: "list_id", leadCol: "lead_id" },
    { table: "list_members", listCol: "list_id", leadCol: "lead_id" },
  ];

  for (const c of candidates) {
    const { data, error } = await supabaseAdmin
      .from(c.table)
      .select(c.leadCol)
      .eq(c.listCol, listId)
      .limit(50000);

    if (!error && Array.isArray(data) && data.length) {
      const ids = data.map((r) => r?.[c.leadCol]).filter(Boolean);
      if (ids.length) return ids;
    }
  }

  return [];
}

async function getPhonesForListDigits(supabaseAdmin, listId) {
  const leadIds = await getLeadIdsForList(supabaseAdmin, listId);
  if (!leadIds.length) return [];

  const out = [];
  const chunk = 400;

  for (let i = 0; i < leadIds.length; i += chunk) {
    const slice = leadIds.slice(i, i + chunk);
    const { data, error } = await supabaseAdmin.from("leads").select("*").in("id", slice);
    if (error || !Array.isArray(data)) continue;

    for (const row of data) {
      const d = pickLeadPhoneDigits(row);
      if (d) out.push({ lead_id: row?.id || null, to_phone: d });
    }
  }

  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(res, 500, { ok: false, error: "Supabase server env missing" });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

    const bearer = getBearer(req);
    if (!bearer) return json(res, 401, { ok: false, error: "Missing Bearer token" });

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(bearer);
    if (uErr || !u?.user?.id) return json(res, 401, { ok: false, error: "Invalid Bearer token" });

    const userId = u.user.id;

    const audience = req.body?.audience || {};
    const audienceType = s(audience.type).toLowerCase();

    const stepsIn = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const steps = stepsIn
      .map((st) => ({
        delay_value: Number(st.delay || 0),
        delay_unit: s(st.unit || "minutes") || "minutes",
        body: s(st.message),
      }))
      .filter((x) => x.body)
      .slice(0, 3);

    if (!steps.length) return json(res, 400, { ok: false, error: "No steps provided" });

    // Recipients
    let recipients = []; // [{lead_id,to_phone}]
    if (audienceType === "manual") {
      const d = normalizeToMsisdnDigits(audience.phone);
      if (!d) return json(res, 400, { ok: false, error: "Missing phone for manual audience" });
      recipients = [{ lead_id: null, to_phone: d }];
    } else if (audienceType === "lead") {
      const leadId = s(audience.lead_id);
      if (!leadId) return json(res, 400, { ok: false, error: "Missing lead_id" });
      const d = await getLeadPhoneDigits(supabaseAdmin, leadId);
      if (!d) return json(res, 400, { ok: false, error: "Selected lead has no phone/mobile" });
      recipients = [{ lead_id: leadId, to_phone: d }];
    } else if (audienceType === "list") {
      const listId = s(audience.list_id);
      if (!listId) return json(res, 400, { ok: false, error: "Missing list_id" });
      const phones = await getPhonesForListDigits(supabaseAdmin, listId);
      if (!phones.length)
        return json(res, 400, { ok: false, error: "No leads with phones found for this list" });
      recipients = phones;
    } else {
      return json(res, 400, { ok: false, error: "Invalid audience.type" });
    }

    // Build queue rows (delay is since previous step)
    const now = new Date();
    const rows = [];

    for (const r of recipients) {
      let cursor = now;
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        const scheduled_for = addDelay(cursor, st.delay_value, st.delay_unit);
        cursor = new Date(scheduled_for);

        // IMPORTANT: insert ONLY real columns (NO origin)
        rows.push({
          user_id: userId,
          lead_id: r.lead_id,
          step_no: i + 1,
          to_phone: r.to_phone,
          body: st.body,
          scheduled_for,
        });
      }
    }

    const { data, error } = await supabaseAdmin.from("sms_queue").insert(rows).select("*");

    if (error) {
      return json(res, 500, {
        ok: false,
        error: "Queue insert failed",
        detail: String(error.message || error),
      });
    }

    return json(res, 200, {
      ok: true,
      queued: Array.isArray(data) ? data.length : rows.length,
      recipients: recipients.length,
      steps: steps.length,
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
}
