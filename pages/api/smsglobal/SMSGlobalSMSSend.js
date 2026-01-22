// /pages/api/smsglobal/SMSGlobalSMSSend.js
// FULL REPLACEMENT
//
<<<<<<< HEAD
// ✅ FIXES:
// - Stops querying leads.phone_number directly (uses select('*') and picks a real phone field)
// - Uses SMSGlobal HTTP API (username/password) instead of REST (fixes 403)
// - Does NOT touch sms_queue table at all (avoids schema cache / missing columns issues)
//
// ENV REQUIRED (set in Vercel/local .env):
//   SMSGLOBAL_USERNAME=your_mxt_username
//   SMSGLOBAL_PASSWORD=your_mxt_password
//   SMSGLOBAL_FROM=614xxxxxxxx  (or your sender id; NO '+' per SMSGlobal HTTP API docs)
// Optional:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
=======
// ✅ Single SMS uses TENANT origin from sms_provider_settings (by org_id)
// ✅ Falls back to accounts/profiles if needed
// ✅ lead_id OR manual { to } supported
// ✅ Multi-tenant safe: lead must belong to logged-in user
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

<<<<<<< HEAD
=======
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SMSGLOBAL_API_KEY = process.env.SMSGLOBAL_API_KEY || process.env.SMSGLOBAL_KEY;
const SMSGLOBAL_API_SECRET =
  process.env.SMSGLOBAL_API_SECRET || process.env.SMSGLOBAL_SECRET;

const DEFAULT_SMS_ORIGIN = (process.env.DEFAULT_SMS_ORIGIN || "gr8result").trim();

>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
function s(v) {
  return String(v ?? "").trim();
}

<<<<<<< HEAD
function normalizeSmsGlobalNumber(input) {
  // SMSGlobal HTTP API: "Do not use + before the country code"
  let v = s(input);
  if (!v) return "";
  v = v.replace(/[^\d+]/g, ""); // keep digits and +
  if (v.startsWith("+")) v = v.slice(1); // remove leading +
  // If it's AU local like 0417..., convert to 61417...
  if (v.startsWith("0") && v.length >= 9) {
    v = "61" + v.slice(1);
  }
  return v;
}

function pickLeadPhone(lead) {
  if (!lead || typeof lead !== "object") return "";
  const candidates = [
    lead.phone_number,
    lead.phone,
    lead.mobile,
    lead.mobile_phone,
    lead.mobileNumber,
    lead.phoneNumber,
    lead.cell,
    lead.cell_phone,
    lead.tel,
    lead.telephone,
  ]
    .map((x) => s(x))
    .filter(Boolean);

  return candidates[0] || "";
}

async function sendViaSmsGlobalHttp({ to, text, from, scheduledatetime }) {
  const user = s(process.env.SMSGLOBAL_USERNAME);
  const password = s(process.env.SMSGLOBAL_PASSWORD);
  const sender = s(from || process.env.SMSGLOBAL_FROM);

  if (!user || !password) {
    return {
      ok: false,
      status: 500,
      error:
        "Missing SMSGLOBAL_USERNAME or SMSGLOBAL_PASSWORD in env. Set them and retry.",
    };
  }

  if (!sender) {
    return {
      ok: false,
      status: 500,
      error:
        "Missing SMSGLOBAL_FROM in env. Set it to your sender ID (NO '+') and retry.",
    };
  }

  const cleanTo = normalizeSmsGlobalNumber(to);
  const cleanFrom = normalizeSmsGlobalNumber(sender);
  const cleanText = s(text);

  if (!cleanTo) {
    return { ok: false, status: 400, error: "Missing/invalid 'to' number." };
  }
  if (!cleanText) {
    return { ok: false, status: 400, error: "Missing/empty message text." };
  }

  const params = new URLSearchParams();
  params.set("action", "sendsms");
  params.set("user", user);
  params.set("password", password);
  params.set("from", cleanFrom || sender); // if it's alpha sender id, keep it
  params.set("to", cleanTo);
  params.set("text", cleanText);

  // Optional scheduling (format: yyyy-mm-dd hh:mm:ss, URL encoded)
  if (scheduledatetime) params.set("scheduledatetime", scheduledatetime);

  const url = `https://api.smsglobal.com/http-api.php?${params.toString()}`;

  const r = await fetch(url, { method: "GET" });
  const bodyText = await r.text();

  // SMSGlobal HTTP API returns 200 even on ERROR; body starts with "OK:" or "ERROR:"
  const ok = bodyText.startsWith("OK:") || bodyText.startsWith("SMSGLOBAL");
  return {
    ok,
    status: r.status,
    provider_raw: bodyText,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      // supported inputs
      to,
      message,
      text,
      from,
      lead_id,
      scheduledatetime, // optional yyyy-mm-dd hh:mm:ss
    } = req.body || {};

    const msg = s(message || text);

    // If lead_id provided, fetch lead and resolve phone without hard-coded columns
    let finalTo = s(to);
    if (!finalTo && lead_id) {
      if (!SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({
          ok: false,
          error:
            "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Needed for lead_id lookup.",
        });
      }
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false },
      });

      const { data: lead, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", lead_id)
        .single();

      if (error) {
        return res.status(500).json({
          ok: false,
          error: `Lead lookup failed: ${error.message}`,
        });
      }

      finalTo = pickLeadPhone(lead);
    }

    const out = await sendViaSmsGlobalHttp({
      to: finalTo,
      text: msg,
      from,
      scheduledatetime,
    });

    if (!out.ok) {
      return res.status(500).json({
        ok: false,
        error: out.error || "SMSGlobal send failed",
        status: out.status,
        provider_raw: out.provider_raw,
      });
    }

    return res.status(200).json({
      ok: true,
      provider: "smsglobal_http",
      status: out.status,
      provider_raw: out.provider_raw,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
=======
function json(res, status, body) {
  res.status(status).json(body);
}

function sanitizeOrigin(origin) {
  let o = s(origin);
  if (!o) return "";
  o = o.replace(/[^a-zA-Z0-9]/g, ""); // remove spaces/symbols
  if (o.length > 11) o = o.slice(0, 11);
  return o;
}

async function getUserFromBearer(req, supabaseAnon) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function getOrgIdForUser(supabaseAdmin, userId) {
  // Try profiles.org_id first (common)
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    if (data?.org_id) return data.org_id;
  } catch {}

  // Try accounts.org_id second (common)
  try {
    const { data } = await supabaseAdmin
      .from("accounts")
      .select("org_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.org_id) return data.org_id;
  } catch {}

  return null;
}

async function pickTenantOrigin(supabaseAdmin, userId) {
  const orgId = await getOrgIdForUser(supabaseAdmin, userId);

  // 1) sms_provider_settings by org_id (YOUR ACTUAL TABLE)
  if (orgId) {
    try {
      const { data } = await supabaseAdmin
        .from("sms_provider_settings")
        .select("origin")
        .eq("org_id", orgId)
        .maybeSingle();

      const cleaned = sanitizeOrigin(data?.origin);
      if (cleaned) return cleaned;
    } catch {}
  }

  // 2) accounts fallback
  try {
    const { data } = await supabaseAdmin
      .from("accounts")
      .select("sms_origin,sms_sender,brand_name,name")
      .eq("user_id", userId)
      .maybeSingle();

    const candidate = data?.sms_origin || data?.sms_sender || data?.brand_name || data?.name;
    const cleaned = sanitizeOrigin(candidate);
    if (cleaned) return cleaned;
  } catch {}

  // 3) profiles fallback
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("sms_origin,sms_sender,brand_name,company,name")
      .eq("id", userId)
      .maybeSingle();

    const candidate =
      data?.sms_origin || data?.sms_sender || data?.brand_name || data?.company || data?.name;
    const cleaned = sanitizeOrigin(candidate);
    if (cleaned) return cleaned;
  } catch {}

  return sanitizeOrigin(DEFAULT_SMS_ORIGIN) || "gr8result";
}

async function sendViaSMSGlobal({ to, message, origin }) {
  if (!SMSGLOBAL_API_KEY || !SMSGLOBAL_API_SECRET) {
    return { ok: false, error: "Missing SMSGLOBAL API env (SMSGLOBAL_API_KEY / SMSGLOBAL_API_SECRET)" };
  }

  // Keep compatible with many SMSGlobal accounts (legacy HTTP API)
  const url = "https://api.smsglobal.com/http-api.php";

  const params = new URLSearchParams();
  params.set("action", "sendsms");
  params.set("user", SMSGLOBAL_API_KEY);
  params.set("password", SMSGLOBAL_API_SECRET);
  params.set("to", to);
  params.set("text", message);

  // Sender/origin
  if (origin) params.set("from", origin);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await resp.text();
  const providerIdMatch = String(text).match(/\b\d{8,}\b/);
  const provider_id = providerIdMatch ? providerIdMatch[0] : null;

  if (!resp.ok) {
    return { ok: false, error: "SMSGlobal HTTP error", status: resp.status, raw: text };
  }

  return { ok: true, provider_id, raw: text };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Method not allowed" });
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
  }

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
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
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    body = req.body || {};
  }

  const message = s(body.message || body.body || body.text);
  if (!message) return json(res, 400, { ok: false, error: "Missing message" });

  let to = s(body.to);
  const lead_id = s(body.lead_id || body.leadId || "");

  // If lead_id provided, pull phone from leads table
  if (!to && lead_id) {
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from("leads")
      .select("id, user_id, phone, mobile, phone_number, mobile_phone")
      .eq("id", lead_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (leadErr) return json(res, 500, { ok: false, error: "Lead lookup failed", detail: leadErr.message });
    if (!lead) return json(res, 404, { ok: false, error: "Lead not found (or not your lead)" });

    to = s(lead.mobile) || s(lead.phone) || s(lead.phone_number) || s(lead.mobile_phone) || "";
    if (!to) return json(res, 400, { ok: false, error: "Lead has no phone number" });
  }

  if (!to) return json(res, 400, { ok: false, error: "Missing 'to' (or lead_id)" });

  const origin = await pickTenantOrigin(supabaseAdmin, user.id);

  const sent = await sendViaSMSGlobal({ to, message, origin });
  if (!sent.ok) return json(res, 500, { ok: false, error: sent.error, detail: sent });

  return json(res, 200, { ok: true, provider_id: sent.provider_id, used_origin: origin, to });
}
