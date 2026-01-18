// /pages/api/twilio/recording-callback.js
// FULL REPLACEMENT
//
// ✅ Receives Twilio Recording Status Callback
// ✅ DOES NOT append junk into Lead notes anymore
// ✅ Upserts into public.crm_calls instead (so UI can read calls cleanly)
//
// Requires env:
//  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
//
// Optional query params you MAY pass from your Twilio webhook URL:
//  ?lead_id=<uuid>&user_id=<uuid>&account_id=<uuid>
//
// Twilio sends x-www-form-urlencoded by default.

import { createClient } from "@supabase/supabase-js";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

const SUPABASE_URL = pickEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
const SERVICE_KEY = pickEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");

function s(v) {
  return String(v ?? "").trim();
}

function nowISO() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase service env" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const qLeadId = s(req.query?.lead_id || req.query?.leadId);
    const qUserId = s(req.query?.user_id);
    const qAccountId = s(req.query?.account_id);

    const body = req.body || {};

    const recordingSid = s(body.RecordingSid || body.recordingSid);
    const callSid = s(body.CallSid || body.callSid);
    const status = s(body.RecordingStatus || body.recordingStatus);
    const duration = body.RecordingDuration ?? body.recordingDuration;

    // Twilio usually includes RecordingUrl (base) in some callbacks
    const recordingUrlBase = s(body.RecordingUrl || body.recordingUrl);
    // We always store a playable local proxy URL by SID (your UI uses this)
    const playableRecordingUrl = recordingSid
      ? `/api/twilio/recording?sid=${encodeURIComponent(recordingSid)}`
      : "";

    // Call details if present
    const from = s(body.From || body.from);
    const to = s(body.To || body.to);
    const direction = s(body.Direction || body.direction) || null;

    // If Twilio didn’t give a recording, accept 200 so it doesn’t retry forever
    if (!recordingSid && !callSid) {
      return res.status(200).json({ ok: true, skipped: true, reason: "No RecordingSid/CallSid" });
    }

    // Insert into crm_calls
    // NOTE: we use twilio_sid = callSid (primary identifier of the call)
    // and store recording_url as the playable proxy.
    const payload = {
      created_at: nowISO(),
      user_id: qUserId || null,
      account_id: qAccountId || null,
      lead_id: qLeadId || null,
      direction: direction || null,
      from_number: from || null,
      to_number: to || null,
      status: status || null,
      duration: callSid ? null : null,
      recording_url: playableRecordingUrl || (recordingUrlBase ? `${recordingUrlBase}.mp3` : null),
      recording_duration:
        duration == null || duration === ""
          ? null
          : Number.isFinite(Number(duration))
          ? Number(duration)
          : null,
      twilio_sid: callSid || null,
      raw_payload: body || null,
      unread: true,
    };

    // Best-effort UPSERT by twilio_sid (if you have a unique index great; if not, fallback insert)
    // We won't assume your constraint exists; attempt update first.
    if (payload.twilio_sid) {
      const { data: existing, error: selErr } = await supabase
        .from("crm_calls")
        .select("id, twilio_sid")
        .eq("twilio_sid", payload.twilio_sid)
        .maybeSingle();

      if (!selErr && existing?.id) {
        const { error: updErr } = await supabase
          .from("crm_calls")
          .update({
            ...payload,
            // don't override created_at on update if you prefer; but safe either way
          })
          .eq("id", existing.id);

        if (updErr) {
          console.error("crm_calls update error:", updErr);
        }

        return res.status(200).json({ ok: true, stored: "crm_calls:update", twilio_sid: payload.twilio_sid });
      }
    }

    const { error: insErr } = await supabase.from("crm_calls").insert(payload);
    if (insErr) {
      console.error("crm_calls insert error:", insErr);
      return res.status(200).json({
        ok: true,
        stored: false,
        warning: "Callback received but crm_calls insert failed",
        error: insErr.message,
      });
    }

    return res.status(200).json({ ok: true, stored: "crm_calls:insert", twilio_sid: payload.twilio_sid || null });
  } catch (e) {
    console.error("[/api/twilio/recording-callback] error:", e);
    // Always 200 to Twilio to avoid infinite retries
    return res.status(200).json({ ok: false, error: e?.message || "Callback failed" });
  }
}
