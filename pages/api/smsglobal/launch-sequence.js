// /pages/api/smsglobal/launch-sequence.js
// FULL REPLACEMENT — queues 1–3 step SMS campaign into sms_queue
//
// ✅ Derives user from Bearer token (NO trusting user_id from client)
// ✅ Uses service role for inserts + lead lookup
// ✅ Supports your schema where list membership is leads.list_id (lead_lists)
// ✅ Ensures lead_id is NEVER NULL (your sms_queue schema shows lead_id NOT NULL)
// ✅ Audience types: manual | lead | list
// ✅ Cumulative schedule: step2 after step1, step3 after step2 (when scheduled_for exists)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function getBearer(req) {
  const h = s(req.headers?.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return s(h.slice(7));
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizePhone(v) {
  const raw = s(v);
  if (!raw) return "";
  let x = raw.replace(/[^\d+]/g, "");
  if (x.startsWith("+")) x = x.slice(1);
  if (x.startsWith("0") && x.length >= 9) x = "61" + x.slice(1);
  if (x.startsWith("61")) return "+" + x;
  return "+" + x.replace(/[^\d]/g, "");
}

function unitToMs(unit) {
  const u = s(unit).toLowerCase();
  if (u === "days") return 24 * 60 * 60 * 1000;
  if (u === "hours") return 60 * 60 * 1000;
  return 60 * 1000;
}

function safeInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function leadIsOptedOut(lead) {
  return Boolean(lead?.opted_out) || Boolean(lead?.sms_opt_out);
}

async function fetchLeadById(sb, uid, lead_id) {
  const { data, error } = await sb
    .from("leads")
    .select("id,user_id,phone,mobile,opted_out,sms_opt_out")
    .eq("id", lead_id)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw new Error(error.message || String(error));
  return data || null;
}

async function ensureLeadForPhone(sb, uid, phoneE164) {
  const phone = s(phoneE164);
  if (!phone) return null;

  // Try match existing lead by phone/mobile
  const { data: existing, error: exErr } = await sb
    .from("leads")
    .select("id,user_id,phone,mobile,opted_out,sms_opt_out")
    .eq("user_id", uid)
    .or(`phone.eq.${phone},mobile.eq.${phone}`)
    .limit(1)
    .maybeSingle();

  if (!exErr && existing?.id) return existing;

  // Create a minimal lead so sms_queue.lead_id can be NOT NULL
  const { data: created, error: crErr } = await sb
    .from("leads")
    .insert(
      [
        {
          user_id: uid,
          name: phone,
          phone: phone,
          mobile: null,
        },
      ],
      { count: "exact" }
    )
    .select("id,user_id,phone,mobile,opted_out,sms_opt_out")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message || String(crErr));
  return created || null;
}

async function fetchLeadsForList(sb, uid, list_id) {
  // Your schema supports: leads.list_id references lead_lists(id)
  const { data: leads, error } = await sb
    .from("leads")
    .select("id,user_id,phone,mobile,opted_out,sms_opt_out")
    .eq("user_id", uid)
    .eq("list_id", list_id)
    .limit(50000);

  if (!error && Array.isArray(leads)) return leads;

  // Fallback (in case you later add join tables)
  const joinCandidates = [
    "lead_list_members",
    "email_list_members",
    "list_members",
    "crm_list_members",
  ];

  for (const joinTable of joinCandidates) {
    const { data: members, error: memErr } = await sb
      .from(joinTable)
      .select("lead_id")
      .eq("list_id", list_id)
      .limit(50000);

    if (memErr || !Array.isArray(members)) continue;

    const ids = members.map((m) => m.lead_id).filter(Boolean);
    if (!ids.length) return [];

    const { data: leads2, error: leadErr } = await sb
      .from("leads")
      .select("id,user_id,phone,mobile,opted_out,sms_opt_out")
      .in("id", ids)
      .eq("user_id", uid)
      .limit(50000);

    if (leadErr) throw new Error(leadErr.message || String(leadErr));
    return leads2 || [];
  }

  return [];
}

async function insertQueueRows(sb, rows) {
  // Try FULL schema first
  const full = rows.map((r) => ({
    user_id: r.user_id,
    lead_id: r.lead_id,
    step_no: r.step_no,
    to_phone: r.to_phone,
    body: r.body,
    scheduled_for: r.scheduled_for,
    status: r.status,
  }));

  const tryFull = await sb.from("sms_queue").insert(full, { count: "exact" });
  if (!tryFull.error) {
    return { ok: true, count: tryFull.count ?? full.length, used: "full" };
  }

  const msg = String(tryFull.error?.message || "").toLowerCase();
  const looksMissingCol = msg.includes("column") && msg.includes("does not exist");

  if (!looksMissingCol) return { ok: false, error: tryFull.error };

  // Minimal fallback
  const minimal = rows.map((r) => ({
    user_id: r.user_id,
    lead_id: r.lead_id,
    step_no: r.step_no,
    to_phone: r.to_phone,
    body: r.body,
  }));

  const tryMin = await sb.from("sms_queue").insert(minimal, { count: "exact" });
  if (!tryMin.error) {
    return { ok: true, count: tryMin.count ?? minimal.length, used: "minimal" };
  }

  return { ok: false, error: tryMin.error };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const sb = admin();

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session token" });
    }
    const uid = userData.user.id;

    const audience = req.body?.audience || {};
    const stepsRaw = Array.isArray(req.body?.steps) ? req.body.steps : [];

    const steps = stepsRaw
      .map((x) => ({
        delay: Math.max(0, safeInt(x?.delay, 0)),
        unit: s(x?.unit || "minutes") || "minutes",
        message: s(x?.message),
      }))
      .filter((x) => x.message)
      .slice(0, 3);

    if (!steps.length) return res.status(400).json({ ok: false, error: "No steps provided" });
    if (!audience?.type) return res.status(400).json({ ok: false, error: "Missing audience.type" });

    // Resolve recipients
    let recipients = []; // { lead_id, user_id, to_phone }
    if (audience.type === "manual") {
      const to = normalizePhone(audience.phone);
      if (!to) return res.status(400).json({ ok: false, error: "Missing manual phone" });

      const lead = await ensureLeadForPhone(sb, uid, to);
      if (!lead) return res.status(500).json({ ok: false, error: "Failed to create/find lead for manual phone" });
      if (leadIsOptedOut(lead)) return res.status(200).json({ ok: true, queued: 0, skipped_opt_out: 1 });

      recipients = [{ lead_id: lead.id, user_id: uid, to_phone: to }];
    } else if (audience.type === "lead") {
      const leadId = s(audience.lead_id);
      if (!leadId) return res.status(400).json({ ok: false, error: "Missing lead_id" });

      const lead = await fetchLeadById(sb, uid, leadId);
      if (!lead) return res.status(404).json({ ok: false, error: "Lead not found for this user" });
      if (leadIsOptedOut(lead)) return res.status(200).json({ ok: true, queued: 0, skipped_opt_out: 1 });

      const to = normalizePhone(lead.mobile || lead.phone);
      if (!to) return res.status(400).json({ ok: false, error: "Lead has no phone/mobile" });

      recipients = [{ lead_id: lead.id, user_id: uid, to_phone: to }];
    } else if (audience.type === "list") {
      const listId = s(audience.list_id);
      if (!listId) return res.status(400).json({ ok: false, error: "Missing list_id" });

      const leads = await fetchLeadsForList(sb, uid, listId);
      const okLeads = (leads || []).filter((l) => !leadIsOptedOut(l));

      recipients = okLeads
        .map((l) => {
          const to = normalizePhone(l.mobile || l.phone);
          if (!to) return null;
          return { lead_id: l.id, user_id: uid, to_phone: to };
        })
        .filter(Boolean);
    } else {
      return res.status(400).json({ ok: false, error: `Unknown audience.type: ${audience.type}` });
    }

    if (!recipients.length) {
      return res.status(200).json({ ok: true, queued: 0, message: "No recipients (opted out / missing numbers)" });
    }

    // Cumulative schedule
    const now = Date.now();
    let cumulativeMs = 0;
    const scheduledFors = steps.map((st) => {
      cumulativeMs += st.delay * unitToMs(st.unit);
      return new Date(now + cumulativeMs).toISOString();
    });

    const rows = [];
    for (const r of recipients) {
      for (let i = 0; i < steps.length; i++) {
        rows.push({
          user_id: uid,
          lead_id: r.lead_id,
          step_no: i + 1,
          to_phone: r.to_phone,
          body: steps[i].message,
          scheduled_for: scheduledFors[i],
          status: "queued",
        });
      }
    }

    const ins = await insertQueueRows(sb, rows);
    if (!ins.ok) {
      return res.status(500).json({
        ok: false,
        error: "Failed to queue campaign",
        detail: ins.error?.message || String(ins.error),
      });
    }

    return res.status(200).json({
      ok: true,
      queued: ins.count,
      recipients: recipients.length,
      steps: steps.length,
      schema_used: ins.used,
      warning:
        ins.used === "minimal"
          ? "sms_queue is missing scheduled_for/status columns. It WILL queue, but spacing requires scheduled_for."
          : null,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: e?.message || String(e),
    });
  }
}
