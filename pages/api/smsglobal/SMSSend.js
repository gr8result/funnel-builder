// /pages/api/smsglobal/SMSSend.js
// FULL REPLACEMENT — Send SMS immediately using proper MAC SHA256 authentication
//
// POST JSON (any of these shapes supported):
// - { lead_id, message }
// - { leadId, body }
// - { lead: { id }, message }
// - { to, message }  (direct phone)
// - { to_phone, body }
//
// ✅ Auth: Authorization: Bearer <SUPABASE ACCESS TOKEN>
// ✅ Finds logged-in user
// ✅ If lead provided, verifies it belongs to the user and uses leads.phone
// ✅ Sends immediately via SMSGlobal with correct MAC SHA256 authentication
// ✅ Uses shared sendSmsGlobal from lib/smsglobal/index.js

import { createClient } from "@supabase/supabase-js";
import { sendSmsGlobal } from "../../../lib/smsglobal/index.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function getBearer(req) {
  const a = s(req.headers.authorization);
  if (!a.toLowerCase().startsWith("bearer ")) return "";
  return a.slice(7).trim();
}

function pickLeadId(body) {
  return (
    s(body?.lead_id) ||
    s(body?.leadId) ||
    s(body?.lead?.id) ||
    s(body?.lead?.value) ||
    s(body?.selectedLeadId) ||
    ""
  );
}

function pickMessage(body) {
  return s(body?.message) || s(body?.body) || s(body?.text) || s(body?.sms) || "";
}

function pickTo(body) {
  return s(body?.to) || s(body?.to_phone) || s(body?.phone) || "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });

    if (!SUPABASE_URL || !ANON_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env (SUPABASE_URL / SUPABASE_ANON_KEY)" });
    }

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return res.status(401).json({ ok: false, error: "Invalid session" });

    const user_id = userData.user.id;
    const body = req.body || {};

    const lead_id = pickLeadId(body);
    const msg = pickMessage(body);
    const directTo = pickTo(body);
    // Accept origin from request, fallback to user_id
    const requestedOrigin = s(body?.origin);
    // Only allow if origin matches the logged-in user_id
    const origin = (requestedOrigin && requestedOrigin === user_id)
      ? requestedOrigin
      : user_id;

    if (!msg) return res.status(400).json({ ok: false, error: "Missing message/body" });

    let toPhone = "";
    let leadName = "";

    if (directTo) {
      toPhone = directTo;
    } else if (lead_id) {
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("id, user_id, phone, name")
        .eq("id", lead_id)
        .maybeSingle();

      if (leadErr) return res.status(500).json({ ok: false, error: leadErr.message });
      if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });
      if (String(lead.user_id) !== String(user_id)) {
        return res.status(403).json({ ok: false, error: "Not allowed for this lead" });
      }

      toPhone = lead.phone || "";
      leadName = lead.name || "";
    } else {
      return res.status(400).json({ ok: false, error: "Missing lead_id (or direct 'to' phone)" });
    }

    if (!toPhone) return res.status(400).json({ ok: false, error: "Missing/invalid to phone" });

    // Send SMS using shared library with proper MAC authentication
    const result = await sendSmsGlobal({
      toPhone,
      message: msg,
      origin,
    });

    if (!result.ok) {
      return res.status(500).json({ 
        ok: false, 
        error: "Failed to send SMS",
        detail: result.body,
        http_status: result.http
      });
    }

    // Return success with provider details
    return res.status(200).json({ 
      ok: true, 
      sent: true,
      destination: result.destination,
      origin: result.used_origin,
      provider_response: result.body,
      lead_name: leadName || undefined
    });
  } catch (e) {
    console.error("SMSSend error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
