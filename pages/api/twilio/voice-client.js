// /pages/api/twilio/voice-client.js
// FULL REPLACEMENT
//
<<<<<<< HEAD
// ✅ TwiML webhook for outgoing calls from Twilio Voice SDK
// ✅ Always returns valid TwiML (prevents 31005 "gateway hangup")
//
// Required env:
//  TWILIO_CALLER_ID=+61...
=======
// ✅ ABSOLUTE recordingStatusCallback URL (Twilio requires absolute)
// ✅ Creates/updates crm_calls immediately (so callback can attach)
// ✅ Passes lead_id + user_id through to callback
// ✅ Records from answer (outbound SDK)
// ✅ Retry-safe (upsert by twilio_sid)
//
// ENV optional (recommended):
//   APP_BASE_URL=https://yourdomain.com   (or your ngrok/Cloudflare/Vercel URL)
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

import { createClient } from "@supabase/supabase-js";

<<<<<<< HEAD
=======
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;

>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
function s(v) {
  return String(v ?? "").trim();
}

<<<<<<< HEAD
function getParam(req, key) {
  const b = req.body || {};
  const q = req.query || {};
  return s(b[key] ?? q[key]);
}

function looksLikeE164(num) {
  return /^\+\d{8,15}$/.test(num);
=======
function normPhone(v) {
  return s(v).replace(/[^\d+]/g, "");
}

function getParam(req, key) {
  const q = req.query || {};
  const b = req.body || {};
  return s(q[key] ?? b[key]);
}

function twiml(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function baseUrl(req) {
  const envBase = s(process.env.APP_BASE_URL);
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto =
    s(req.headers["x-forwarded-proto"]) ||
    (req.socket?.encrypted ? "https" : "http");
  const host =
    s(req.headers["x-forwarded-host"]) ||
    s(req.headers.host) ||
    "localhost:3000";
  return `${proto}://${host}`.replace(/\/+$/, "");
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
}

export default async function handler(req, res) {
  try {
<<<<<<< HEAD
    const callerId = s(process.env.TWILIO_CALLER_ID);
    const To = getParam(req, "To") || getParam(req, "to");
    const record = getParam(req, "record");

    const vr = new twilio.twiml.VoiceResponse();

    if (!callerId || !looksLikeE164(callerId)) {
      vr.say({ voice: "alice" }, "Missing caller I D.");
      vr.hangup();
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(vr.toString());
    }

    if (!To || !looksLikeE164(To)) {
      vr.say({ voice: "alice" }, "Invalid destination number.");
      vr.hangup();
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(vr.toString());
    }

    const dial = vr.dial({ callerId });

    const wantRecord =
      record === "1" || record === "true" || record === "yes";

    if (wantRecord) dial.number({ record: "record-from-answer" }, To);
    else dial.number(To);

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(vr.toString());
  } catch (e) {
    console.error("[/api/twilio/voice-client] error:", e);
    const vr = new twilio.twiml.VoiceResponse();
    vr.say({ voice: "alice" }, "Application error.");
    vr.hangup();
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(vr.toString());
=======
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml("<Say>Server misconfigured.</Say>"));
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const toRaw = getParam(req, "To");
    const to = normPhone(toRaw);
    const leadId = getParam(req, "lead_id") || getParam(req, "leadId");
    const userId = getParam(req, "user_id") || getParam(req, "userId");

    const callSid = getParam(req, "CallSid");
    const from = normPhone(getParam(req, "From") || getParam(req, "Caller"));

    if (!to) {
      res.setHeader("Content-Type", "text/xml");
      return res
        .status(200)
        .send(twiml("<Say>Missing destination number.</Say>"));
    }

    // Create/Upsert crm_calls row NOW
    if (callSid) {
      await supabase.from("crm_calls").upsert(
        {
          twilio_sid: callSid,
          lead_id: leadId || null,
          user_id: userId || null,
          direction: "outbound",
          from_number: from || null,
          to_number: to || null,
          status: "in_progress",
          unread: true,
        },
        { onConflict: "twilio_sid" }
      );
    }

    const qs = new URLSearchParams();
    if (leadId) qs.set("lead_id", leadId);
    if (userId) qs.set("user_id", userId);

    const cbAbsolute =
      `${baseUrl(req)}/api/twilio/recording-callback` +
      (qs.toString() ? `?${qs.toString()}` : "");

    const xml =
      `<Dial ` +
      `record="record-from-answer" ` +
      `recordingStatusCallback="${cbAbsolute}" ` +
      `recordingStatusCallbackEvent="completed" ` +
      `recordingStatusCallbackMethod="POST">` +
      `<Number>${to}</Number>` +
      `</Dial>`;

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml(xml));
  } catch (e) {
    console.error("[voice-client]", e);
    res.setHeader("Content-Type", "text/xml");
    return res
      .status(200)
      .send(twiml("<Say>Sorry, the call could not be completed.</Say>"));
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
  }
}
