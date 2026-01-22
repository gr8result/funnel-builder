// /pages/api/crm/lead-call-recordings.js
// FULL REPLACEMENT
//
<<<<<<< HEAD
// ✅ Auth: Authorization: Bearer <supabase_access_token>
// ✅ Multi-tenant safe: validates lead belongs to the logged-in user FIRST
// ✅ Loads recordings from public.crm_calls
//    - Primary: crm_calls.lead_id = lead_id
//    - Fallback: matches lead phone against crm_calls.from_number / to_number
//
// Query:
//   ?lead_id=<uuid>
//
// ENV required:
//   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)
=======
// ✅ Uses Supabase SERVICE ROLE (server-side) to bypass RLS
// ✅ Auth required: Authorization: Bearer <supabase access token>
// ✅ Returns recordings for a lead_id from public.crm_calls
//
// Expected output:
// { ok: true, recordings: [ { sid, recordingUrl, created_at, duration, ... } ] }
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

<<<<<<< HEAD
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
=======
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE;
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

function s(v) {
  return String(v ?? "").trim();
}

<<<<<<< HEAD
function digitsOnly(v) {
  return s(v).replace(/[^\d]/g, "");
}

// Builds phone patterns that will match a lot of formats (+61..., 0417..., 617..., etc)
function buildPhonePatterns(rawPhone) {
  const d = digitsOnly(rawPhone);
  if (!d) return [];

  const out = new Set();

  // last 9/10 digits are very stable for AU mobiles
  if (d.length >= 9) out.add(d.slice(-9));
  if (d.length >= 10) out.add(d.slice(-10));

  // if starts with 61, add local 0...
  if (d.startsWith("61") && d.length >= 11) {
    out.add("0" + d.slice(2)); // 61xxxxxxxxx -> 0xxxxxxxxx
    out.add(d.slice(2)); // xxxxxxxxx
  }

  // if starts with 0, add 61...
  if (d.startsWith("0") && d.length >= 9) {
    out.add("61" + d.slice(1));
    out.add(d.slice(1));
  }

  // add the full digits too
  out.add(d);

  // remove tiny patterns
  return Array.from(out).filter((x) => x.length >= 7);
}

=======
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

<<<<<<< HEAD
=======
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (service role) env vars.",
      });
    }

    // require logged-in user token (so randoms cannot scrape recordings)
    const auth = s(req.headers.authorization);
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
    const lead_id = s(req.query.lead_id);
    if (!lead_id) {
      return res.status(400).json({ ok: false, error: "Missing lead_id" });
    }

<<<<<<< HEAD
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const auth = s(req.headers.authorization);
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing bearer token" });
    }

    // Verify user token (anon client)
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }
    const user = userData.user;

    // Service role client
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) AUTHORIZE: lead must belong to this user
    const { data: leadRow, error: leadErr } = await admin
      .from("leads")
      .select("id, user_id, phone")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr) {
      return res.status(500).json({ ok: false, error: leadErr.message });
    }
    if (!leadRow) {
      return res.status(404).json({ ok: false, error: "Lead not found" });
    }
    if (s(leadRow.user_id) !== user.id) {
      return res
        .status(403)
        .json({ ok: false, error: "Not authorized for this lead" });
    }

    // columns per your table definition screenshot
    const selectCols =
      "id, created_at, from_number, to_number, recording_url, recording_duration, twilio_sid, lead_id";

    // 2) PRIMARY: by lead_id
    const primary = await admin
      .from("crm_calls")
      .select(selectCols)
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (primary.error) {
      return res.status(500).json({ ok: false, error: primary.error.message });
    }

    let rows = primary.data || [];
    let mode = "lead_id";

    // 3) FALLBACK: match by phone if none linked
    if (!rows.length) {
      const phone = s(leadRow.phone);
      const patterns = buildPhonePatterns(phone);

      if (patterns.length) {
        // Build OR filter:
        // from_number ILIKE %pattern% OR to_number ILIKE %pattern%
        // Use a few strongest patterns to avoid huge OR strings
        const top = patterns.slice(0, 4);

        const ors = [];
        for (const p of top) {
          ors.push(`from_number.ilike.%${p}%`);
          ors.push(`to_number.ilike.%${p}%`);
        }

        const fallback = await admin
          .from("crm_calls")
          .select(selectCols)
          .or(ors.join(","))
          .order("created_at", { ascending: false })
          .limit(200);

        if (!fallback.error) {
          rows = fallback.data || [];
          mode = "phone_fallback";
        }
      }
    }

    const recordings = (rows || [])
      .filter((r) => s(r.recording_url) || s(r.twilio_sid))
      .map((r) => ({
        id: r.id,
        created_at: r.created_at,
        from_number: r.from_number || "",
        to_number: r.to_number || "",
        recording_url: r.recording_url || "",
        recording_duration: r.recording_duration ?? null,
        sid: r.twilio_sid || "",
      }));

    return res.status(200).json({
      ok: true,
      mode, // "lead_id" or "phone_fallback"
      count: recordings.length,
      recordings,
    });
  } catch (e) {
    console.error("lead-call-recordings error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Server error" });
=======
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Optional: verify the token is valid (light check)
    // We don't need the user object here for filtering because we query by lead_id,
    // but we DO want to ensure caller is authenticated.
    const anon = createClient(SUPABASE_URL, s(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""), {
      auth: { persistSession: false },
    });

    // If you do not have anon key set, we skip verification.
    const anonKey = s(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "");
    if (anonKey) {
      const token = s(auth.split(" ")[1]);
      const { data: userData, error: userErr } = await anon.auth.getUser(token);
      if (userErr || !userData?.user?.id) {
        return res.status(401).json({ ok: false, error: "Invalid session" });
      }
    }

    // Pull calls for the lead_id
    // IMPORTANT: adjust column names here only if your crm_calls schema differs.
    const { data, error } = await admin
      .from("crm_calls")
      .select(
        `
        id,
        lead_id,
        user_id,
        created_at,
        call_sid,
        recording_sid,
        recording_url,
        recordingUrl,
        duration,
        recording_duration,
        status
      `
      )
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    const rows = Array.isArray(data) ? data : [];

    // Normalize to what LeadDetailsModal expects: { sid, recordingUrl, createdAt, duration }
    const recordings = rows
      .map((r) => {
        const recordingUrl =
          s(r.recordingUrl) || s(r.recording_url) || s(r.recordingUrl) || "";
        const sid = s(r.recording_sid) || s(r.recordingSid) || s(r.recording_sid) || "";
        const createdAt = r.created_at || null;
        const duration = r.duration ?? r.recording_duration ?? null;

        // If you stored recording url but not sid, UI can extract sid from url
        if (!sid && !recordingUrl) return null;

        return {
          id: r.id,
          lead_id: r.lead_id,
          user_id: r.user_id,
          createdAt,
          created_at: createdAt,
          duration,
          recordingUrl,
          recording_url: recordingUrl,
          sid,
          recordingSid: sid,
          status: r.status || null,
          callSid: s(r.call_sid) || null,
        };
      })
      .filter(Boolean);

    return res.status(200).json({ ok: true, recordings });
  } catch (e) {
    console.error("lead-call-recordings error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
  }
}
