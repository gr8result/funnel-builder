// /pages/api/email/autoresponders/enroll-existing.js
// FULL REPLACEMENT — Enroll existing list members into public.email_autoresponder_queue
//
// ✅ Multi-tenant safe: derives user_id from Bearer token (Supabase access_token)
// ✅ Reads autoresponder from email_automations + verifies owner
// ✅ MUCH MORE robust list-member loading:
//    - Tries multiple member tables
//    - Tries multiple list id column names (list_id, lead_list_id, list_uuid, lead_list_uuid, etc.)
//    - Works whether member table HAS user_id or NOT (falls back to list_id-only)
//    - Extracts lead ids from many possible keys
//    - If NO lead_id exists but email exists, still enqueues using to_email with lead_id = null
// ✅ Joins to leads when lead_ids exist (and filters by leads.user_id for safety)
// ✅ Inserts into email_autoresponder_queue idempotently (upsert)
// ✅ Returns debug so you can see EXACTLY what it found and why added=0

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function send(res, status, body) {
  return res.status(status).json(body);
}

function mapDayToIndex(d) {
  const m = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return m[d] ?? null;
}

function nextAllowedDay(date, active_days) {
  const allowed = new Set(
    (active_days || []).map(mapDayToIndex).filter((x) => x !== null)
  );
  if (!allowed.size) return date;

  const out = new Date(date);
  for (let i = 0; i < 14; i++) {
    if (allowed.has(out.getDay())) return out;
    out.setDate(out.getDate() + 1);
  }
  return out;
}

function computeScheduledAt(now, send_day, send_time, active_days) {
  const d = new Date(now);

  const sd = String(send_day || "").toLowerCase();
  if (sd.includes("next day")) d.setDate(d.getDate() + 1);
  if (sd.includes("2 days")) d.setDate(d.getDate() + 2);

  const st = String(send_time || "");
  const setHour = (h) => d.setHours(h, 0, 0, 0);

  if (st === "9 AM") setHour(9);
  else if (st === "12 PM") setHour(12);
  else if (st === "6 PM") setHour(18);

  const adjusted = nextAllowedDay(d, active_days);
  return adjusted.toISOString();
}

async function getUserIdFromBearer(req) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user?.id || null;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function normalizeEmail(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.toLowerCase();
}

function tryExtractLeadId(row) {
  // common variations we’ve seen across your project
  return pickFirst(row, [
    "lead_id",
    "leadId",
    "lead_uuid",
    "leadUuid",
    "contact_id",
    "contactId",
    "contact_uuid",
    "contactUuid",
    "member_id",
    "memberId",
    "id", // last resort
  ]);
}

function tryExtractEmail(row) {
  return pickFirst(row, [
    "email",
    "email_address",
    "emailAddress",
    "to_email",
    "toEmail",
    "subscriber_email",
    "subscriberEmail",
  ]);
}

function tryExtractName(row) {
  const full = pickFirst(row, ["full_name", "name", "to_name", "toName"]);
  if (full) return String(full).trim();

  const first = pickFirst(row, ["first_name", "firstName"]);
  const last = pickFirst(row, ["last_name", "lastName"]);
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
}

async function queryMembersFlexible({ table, user_id, list_id }) {
  // We try multiple list id column names AND with/without user_id.
  // If a column doesn’t exist, PostgREST throws an error; we catch and try next variant.

  const listCols = [
    "list_id",
    "lead_list_id",
    "list_uuid",
    "lead_list_uuid",
    "email_list_id",
    "email_list_uuid",
  ];

  const userCols = ["user_id", "account_id", "owner_id"];

  const attempts = [];

  // attempt matrix:
  // 1) list filter only (most universal)
  // 2) user+list filter (if user col exists)
  // For each: try all list col names.
  for (const lc of listCols) {
    attempts.push({
      mode: "list_only",
      listCol: lc,
      userCol: null,
    });
  }
  for (const uc of userCols) {
    for (const lc of listCols) {
      attempts.push({
        mode: "user_and_list",
        listCol: lc,
        userCol: uc,
      });
    }
  }

  let lastError = null;

  for (const a of attempts) {
    try {
      let q = supabaseAdmin.from(table).select("*").eq(a.listCol, list_id);
      if (a.userCol) q = q.eq(a.userCol, user_id);

      const { data, error } = await q;
      if (error) {
        lastError = error;
        continue;
      }

      const rows = Array.isArray(data) ? data : [];
      return {
        ok: true,
        table,
        mode: a.mode,
        listCol: a.listCol,
        userCol: a.userCol,
        rows,
        note: "ok",
      };
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  return {
    ok: false,
    table,
    mode: null,
    listCol: null,
    userCol: null,
    rows: [],
    note: `query_failed:${String(lastError?.message || lastError || "unknown")}`,
  };
}

async function loadMembersBestEffort({ user_id, list_id }) {
  const candidates = [
    "email_list_members",
    "lead_list_members",
    "lead_lists_members",
    "list_members",
  ];

  let best = null;

  for (const table of candidates) {
    const r = await queryMembersFlexible({ table, user_id, list_id });

    // Keep the first table we can query successfully (even if empty)
    if (!best && r.ok) best = r;

    // If it has rows, return immediately
    if (r.ok && (r.rows || []).length) return r;
  }

  return (
    best || {
      ok: false,
      table: null,
      mode: null,
      listCol: null,
      userCol: null,
      rows: [],
      note: "no_member_table_found",
    }
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { ok: false, error: "POST only" });
  }

  try {
    const user_id = await getUserIdFromBearer(req);
    if (!user_id) return send(res, 401, { ok: false, error: "Unauthorized" });

    const { autoresponder_id, list_id } = req.body || {};
    if (!autoresponder_id) {
      return send(res, 400, { ok: false, error: "Missing autoresponder_id" });
    }

    // load autoresponder
    const { data: ar, error: arErr } = await supabaseAdmin
      .from("email_automations")
      .select(
        "id,user_id,list_id,from_name,from_email,reply_to,subject,template_path,send_day,send_time,active_days"
      )
      .eq("id", autoresponder_id)
      .single();

    if (arErr || !ar)
      return send(res, 404, { ok: false, error: "Autoresponder not found" });
    if (String(ar.user_id) !== String(user_id))
      return send(res, 403, { ok: false, error: "Not allowed" });

    const finalListId = String(list_id || ar.list_id || "");
    if (!finalListId) {
      return send(res, 400, {
        ok: false,
        error: "Missing list_id (and autoresponder has no list_id saved)",
      });
    }

    if (ar.list_id && String(ar.list_id) !== finalListId) {
      return send(res, 400, {
        ok: false,
        error: "list_id does not match autoresponder.list_id",
      });
    }

    if (!ar.subject || !ar.template_path || !ar.from_email) {
      return send(res, 400, {
        ok: false,
        error: "Autoresponder missing subject, template_path, or from_email",
      });
    }

    const membersInfo = await loadMembersBestEffort({
      user_id,
      list_id: finalListId,
    });

    const memberRows = Array.isArray(membersInfo?.rows) ? membersInfo.rows : [];

    // Extract lead_ids + emails from member rows
    const extractedLeadIds = [];
    const extractedEmails = [];

    for (const r of memberRows) {
      const lid = tryExtractLeadId(r);
      if (lid) extractedLeadIds.push(String(lid));

      const em = normalizeEmail(tryExtractEmail(r));
      if (em) extractedEmails.push(em);
    }

    // unique
    const leadIds = Array.from(new Set(extractedLeadIds));
    const emails = Array.from(new Set(extractedEmails));

    const scheduled_at = computeScheduledAt(
      new Date(),
      ar.send_day,
      ar.send_time,
      ar.active_days || ["Mon", "Tue", "Wed", "Thu", "Fri"]
    );

    // If we have lead_ids, load leads (safely scoped by leads.user_id)
    let leads = [];
    if (leadIds.length) {
      const { data: ld, error: lErr } = await supabaseAdmin
        .from("leads")
        .select("id,email,full_name,first_name,last_name")
        .eq("user_id", user_id)
        .in("id", leadIds);

      if (lErr) {
        return send(res, 500, {
          ok: false,
          error: "Load leads failed: " + lErr.message,
          debug: {
            members_source: membersInfo?.table || null,
            members_mode: membersInfo?.mode || null,
            members_list_col: membersInfo?.listCol || null,
            members_user_col: membersInfo?.userCol || null,
            members_note: membersInfo?.note || null,
            members_found: memberRows.length,
            extracted_lead_ids: leadIds.length,
            extracted_emails: emails.length,
          },
        });
      }
      leads = Array.isArray(ld) ? ld : [];
    }

    // Build queue rows from leads (preferred)
    const rowsFromLeads = (leads || [])
      .filter((ld) => !!ld.email)
      .map((ld) => {
        const nm =
          ld.full_name ||
          [ld.first_name, ld.last_name].filter(Boolean).join(" ").trim() ||
          null;

        return {
          user_id,
          autoresponder_id: ar.id,
          list_id: finalListId,
          lead_id: ld.id,
          to_email: String(ld.email).trim(),
          to_name: nm,
          subject: ar.subject,
          template_path: ar.template_path,
          scheduled_at,
          status: "queued",
          attempts: 0,
        };
      });

    // If no lead rows, fall back to email-only membership (lead_id null)
    // (Your table supports lead_id NULL and has unique index by (autoresponder_id, to_email) when lead_id is null)
    const haveAnyLeadRows = rowsFromLeads.length > 0;
    const rowsFromEmails =
      haveAnyLeadRows || !emails.length
        ? []
        : emails.map((em) => ({
            user_id,
            autoresponder_id: ar.id,
            list_id: finalListId,
            lead_id: null,
            to_email: em,
            to_name: null,
            subject: ar.subject,
            template_path: ar.template_path,
            scheduled_at,
            status: "queued",
            attempts: 0,
          }));

    const rows = [...rowsFromLeads, ...rowsFromEmails];

    if (!rows.length) {
      return send(res, 200, {
        ok: true,
        added: 0,
        skipped: 0,
        scheduled_at,
        debug: {
          members_source: membersInfo?.table || null,
          members_mode: membersInfo?.mode || null,
          members_list_col: membersInfo?.listCol || null,
          members_user_col: membersInfo?.userCol || null,
          members_note: membersInfo?.note || null,
          members_found: memberRows.length,
          sample_member_keys: memberRows[0] ? Object.keys(memberRows[0]) : [],
          extracted_lead_ids: leadIds.length,
          extracted_emails: emails.length,
          leads_loaded: leads.length,
          leads_with_email_rows: rowsFromLeads.length,
          email_only_rows: rowsFromEmails.length,
        },
        note:
          memberRows.length === 0
            ? "No member rows found for that list in any member table."
            : "Member rows found, but no lead_id AND no email could be extracted from them.",
      });
    }

    // Upsert strategy:
    // - For lead-based rows: conflict on (autoresponder_id, lead_id)
    // - For email-only rows: conflict on (autoresponder_id, to_email) (your index exists for lead_id is null)
    //
    // Supabase upsert can only use ONE onConflict target at a time,
    // so we upsert in two passes if needed.

    let addedLead = 0;
    let addedEmailOnly = 0;

    if (rowsFromLeads.length) {
      const { error: upErr } = await supabaseAdmin
        .from("email_autoresponder_queue")
        .upsert(rowsFromLeads, { onConflict: "autoresponder_id,lead_id" });

      if (upErr) {
        return send(res, 500, {
          ok: false,
          error: "Queue upsert (lead) failed: " + upErr.message,
          debug: {
            members_source: membersInfo?.table || null,
            members_mode: membersInfo?.mode || null,
            members_list_col: membersInfo?.listCol || null,
            members_user_col: membersInfo?.userCol || null,
            members_note: membersInfo?.note || null,
            members_found: memberRows.length,
            extracted_lead_ids: leadIds.length,
            extracted_emails: emails.length,
            leads_loaded: leads.length,
          },
        });
      }
      addedLead = rowsFromLeads.length;
    }

    if (rowsFromEmails.length) {
      const { error: upErr2 } = await supabaseAdmin
        .from("email_autoresponder_queue")
        .upsert(rowsFromEmails, { onConflict: "autoresponder_id,to_email" });

      if (upErr2) {
        return send(res, 500, {
          ok: false,
          error: "Queue upsert (email-only) failed: " + upErr2.message,
          debug: {
            members_source: membersInfo?.table || null,
            members_mode: membersInfo?.mode || null,
            members_list_col: membersInfo?.listCol || null,
            members_user_col: membersInfo?.userCol || null,
            members_note: membersInfo?.note || null,
            members_found: memberRows.length,
            extracted_lead_ids: leadIds.length,
            extracted_emails: emails.length,
          },
        });
      }
      addedEmailOnly = rowsFromEmails.length;
    }

    return send(res, 200, {
      ok: true,
      added: addedLead + addedEmailOnly,
      added_lead_rows: addedLead,
      added_email_only_rows: addedEmailOnly,
      scheduled_at,
      debug: {
        members_source: membersInfo?.table || null,
        members_mode: membersInfo?.mode || null,
        members_list_col: membersInfo?.listCol || null,
        members_user_col: membersInfo?.userCol || null,
        members_note: membersInfo?.note || null,
        members_found: memberRows.length,
        sample_member_keys: memberRows[0] ? Object.keys(memberRows[0]) : [],
        extracted_lead_ids: leadIds.length,
        extracted_emails: emails.length,
        leads_loaded: leads.length,
      },
    });
  } catch (e) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
