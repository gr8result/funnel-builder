// /pages/api/crm/lead-call-recordings.js
// FULL REPLACEMENT
//
// ✅ Auth: Authorization: Bearer <supabase_access_token>
// ✅ Multi-tenant safe: verifies lead belongs to logged-in user FIRST
// ✅ Loads calls from public.crm_calls
//    - Primary: crm_calls.lead_id = lead_id
//    - Fallback: matches lead phone/mobile against crm_calls.contact_number / to_number / from_number
// ✅ Returns newest-first so timeline is correct
//
// Query:
//   ?lead_id=<uuid>
//
// Returns:
//   { ok:true, calls:[ ... ] }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function getBearer(req) {
  const h = s(req.headers.authorization);
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function normalizePhone(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
  if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);
  return v;
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env" });
    }

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const lead_id = s(req.query.lead_id);
    if (!lead_id) return res.status(400).json({ ok: false, error: "Missing lead_id" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Validate user
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const userId = userData?.user?.id || null;
    if (userErr || !userId) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    // Verify lead belongs to this user
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id,user_id,phone,mobile,name,first_name,last_name,full_name")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr) return res.status(500).json({ ok: false, error: leadErr.message });
    if (!lead?.id) return res.status(404).json({ ok: false, error: "Lead not found" });
    if (String(lead.user_id) !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const p1 = normalizePhone(lead.phone);
    const p2 = normalizePhone(lead.mobile);

    // Primary: by lead_id
    // Fallback: by phone match (some older rows might have lead_id null)
    let query = supabase
      .from("crm_calls")
      .select(
        [
          "id",
          "created_at",
          "direction",
          "from_number",
          "to_number",
          "status",
          "duration",
          "lead_id",
          "recording_sid",
          "recording_url",
          "transcription",
          "caller_name",
          "twilio_sid",
        ].join(",")
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (p1 || p2) {
      const phones = [p1, p2].filter(Boolean);
      // Match against multiple columns that exist in your crm_calls schema
      // (contact_number + from/to)
      query = query.or(
        [
          `lead_id.eq.${lead_id}`,
          ...(phones.map((ph) => `contact_number.eq.${ph}`)),
          ...(phones.map((ph) => `to_number.eq.${ph}`)),
          ...(phones.map((ph) => `from_number.eq.${ph}`)),
        ].join(",")
      );
    } else {
      query = query.eq("lead_id", lead_id);
    }

    const { data: rows, error: callsErr } = await query;
    if (callsErr) return res.status(500).json({ ok: false, error: callsErr.message });

    return res.status(200).json({ ok: true, calls: rows || [] });
  } catch (e) {
    console.error("lead-call-recordings error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
