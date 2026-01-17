// /pages/api/smsglobal/SMSGlobalSMSSend.js
// FULL REPLACEMENT — Single SMS sender that works with lead picker
//
// ✅ Accepts: { lead_id, message, origin? } OR { to, message, origin? }
// ✅ If lead_id is provided, it looks up phone from public.leads
// ✅ Validates origin against allowed list, otherwise falls back
// ✅ Uses SMSGlobal MAC auth

import { createClient } from "@supabase/supabase-js";
import { buildSmsGlobalMacHeader } from "../../../lib/smsglobal/macAuth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

function s(v) {
  return String(v ?? "").trim();
}

function digitsOnly(v) {
  return s(v).replace(/[^\d+]/g, "");
}

// Minimal AU normalizer: 04... -> 614..., +61... -> 61..., 61... stays
function normalizeAUTo61(raw) {
  let v = digitsOnly(raw);
  if (!v) return "";
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("0")) v = "61" + v.slice(1);
  // If already 61..., keep
  return v;
}

function allowedOrigins() {
  // Example: "gr8result,Gr8 Result"
  const list = s(process.env.SMSGLOBAL_ALLOWED_ORIGINS || "");
  return list
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function pickOrigin(requestedOrigin) {
  const fallback = s(process.env.DEFAULT_SMS_ORIGIN || "gr8result");
  const o = s(requestedOrigin);
  if (!o) return fallback;

  const allow = allowedOrigins();
  if (!allow.length) return fallback; // if not configured, always use fallback

  // Must match exactly what SMSGlobal approved
  if (allow.includes(o)) return o;
  return fallback;
}

async function getUserIdFromRequest(req) {
  const auth = s(req.headers.authorization);
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

async function getLeadPhone(lead_id) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id, phone, phone_number, mobile, mobile_phone, user_id")
    .eq("id", lead_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { phone: "", lead: null };

  const phone =
    data.phone ||
    data.phone_number ||
    data.mobile ||
    data.mobile_phone ||
    "";

  return { phone, lead: data };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = req.body || {};
    const lead_id = s(body.lead_id);
    const message = s(body.message || body.body);
    const rawTo = s(body.to || body.to_phone);

    if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

    let to = rawTo;
    let lead = null;

    if (lead_id) {
      const r = await getLeadPhone(lead_id);
      lead = r.lead;

      if (!lead) return res.status(400).json({ ok: false, error: "Lead not found" });
      if (s(lead.user_id) && s(lead.user_id) !== s(userId)) {
        return res.status(403).json({ ok: false, error: "Not allowed for this lead" });
      }

      to = s(r.phone);
    }

    const to61 = normalizeAUTo61(to);
    if (!to61) return res.status(400).json({ ok: false, error: "Missing/invalid to" });

    const origin = pickOrigin(body.origin);

    // SMSGlobal endpoint
    const url = "https://api.smsglobal.com/v2/sms/";
    const apiKey = s(process.env.SMSGLOBAL_API_KEY);
    const secretKey = s(process.env.SMSGLOBAL_API_SECRET);
    if (!apiKey || !secretKey) return res.status(500).json({ ok: false, error: "Missing SMSGlobal env keys" });

    const payload = {
      origin,          // Sender ID (must be approved)
      destination: to61,
      message,
    };

    const { header } = buildSmsGlobalMacHeader({
      apiKey,
      secretKey,
      method: "POST",
      url,
    });

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: header,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const txt = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        smsglobal_http: r.status,
        smsglobal_body: parsed || txt,
        used_origin: origin,
        used_destination: to61,
      });
    }

    // SMSGlobal usually returns {id: ...} or {messages:[...]} depending on API
    const provider_id = parsed?.id ?? parsed?.messages?.[0]?.id ?? null;

    return res.status(200).json({
      ok: true,
      provider_id,
      used_origin: origin,
      used_destination: to61,
      raw: parsed || txt,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
