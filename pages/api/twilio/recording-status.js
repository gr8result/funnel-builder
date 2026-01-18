// /pages/api/twilio/recording-status.js
// FULL REPLACEMENT
//
// ✅ Receives Twilio recordingStatusCallback (alt webhook)
// ✅ DOES NOT write into lead notes
// ✅ Stores into public.crm_calls (best-effort)
//
// Requires env:
//  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
//  SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  // Always return 200 to Twilio so it doesn't retry forever
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(200).json({ ok: false, error: "Missing Supabase env" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = req.body || {};

    const leadId = s(req.query?.leadId || req.query?.lead_id || body?.leadId || body?.lead_id);
    const userId = s(req.query?.user_id || body?.user_id);
    const accountId = s(req.query?.account_id || body?.account_id);

    const recordingSid = s(body.RecordingSid || body.recordingSid);
    const callSid = s(body.CallSid || body.callSid);
    const status = s(body.RecordingStatus || body.recordingStatus);
    const recordingUrlBase = s(body.RecordingUrl || body.recordingUrl);
    const duration = body.RecordingDuration ?? body.recordingDuration;

    const from = s(body.From || body.from);
    const to = s(body.To || body.to);
    const direction = s(body.Direction || body.direction) || null;

    if (!recordingSid && !callSid) {
      return res.status(200).json({ ok: true, skipped: true, reason: "No RecordingSid/CallSid" });
    }

    const playableRecordingUrl = recordingSid
      ? `/api/twilio/recording?sid=${encodeURIComponent(recordingSid)}`
      : recordingUrlBase
      ? `${recordingUrlBase}.mp3`
      : null;

    const payload = {
      created_at: nowISO(),
      user_id: userId || null,
      account_id: accountId || null,
      lead_id: leadId || null,
      direction: direction || null,
      from_number: from || null,
      to_number: to || null,
      status: status || null,
      recording_url: playableRecordingUrl,
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

    if (payload.twilio_sid) {
      const { data: existing, error: selErr } = await supabase
        .from("crm_calls")
        .select("id, twilio_sid")
        .eq("twilio_sid", payload.twilio_sid)
        .maybeSingle();

      if (!selErr && existing?.id) {
        const { error: updErr } = await supabase
          .from("crm_calls")
          .update(payload)
          .eq("id", existing.id);

        if (updErr) {
          return res.status(200).json({ ok: true, stored: false, error: updErr.message });
        }
        return res.status(200).json({ ok: true, stored: "crm_calls:update" });
      }
    }

    const { error: insErr } = await supabase.from("crm_calls").insert(payload);
    if (insErr) {
      return res.status(200).json({ ok: true, stored: false, error: insErr.message });
    }

    return res.status(200).json({ ok: true, stored: "crm_calls:insert" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
