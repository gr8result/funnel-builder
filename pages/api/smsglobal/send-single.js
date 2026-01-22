// /pages/api/smsglobal/send-single.js
// FULL REPLACEMENT — Queue ONE SMS (Single SMS box)
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
// ✅ Inserts into public.sms_queue WITHOUT using 'origin' column (avoids schema cache issues)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function digitsOnly(v) {
  return s(v).replace(/[^\d+]/g, "");
}

function normalizeAUTo61(raw) {
  let v = digitsOnly(raw);
  if (!v) return "";
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("0")) v = "61" + v.slice(1);
  return v;
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

    if (!msg) return res.status(400).json({ ok: false, error: "Missing message/body" });

    let toPhone = "";
    let resolvedLeadId = lead_id || null;

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
    } else {
      return res.status(400).json({ ok: false, error: "Missing lead_id (or direct 'to' phone)" });
    }

    const to61 = normalizeAUTo61(toPhone);
    if (!to61) return res.status(400).json({ ok: false, error: "Missing/invalid to phone" });

    // Insert WITHOUT origin column to avoid schema cache/origin mismatch
    const insertRow = {
      user_id,
      lead_id: resolvedLeadId,
      to_phone: to61,
      body: msg,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("sms_queue")
      .insert(insertRow)
      .select("*")
      .single();

    if (insErr) return res.status(500).json({ ok: false, error: insErr.message });

    return res.status(200).json({ ok: true, queued: 1, row: inserted });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
