// /pages/api/twilio/voice-client.js
// FULL REPLACEMENT
//
// ✅ Outgoing TwiML for Twilio Voice SDK (browser dialer)
// ✅ HARD BLOCKS inbound/self-dial loops (stops Twilio junk calls to your own virtual number)
// ✅ Records from answer (optional)
// ✅ recordingStatusCallback -> /api/twilio/recording-callback
//
// IMPORTANT:
// - If Twilio hits this endpoint for INBOUND calls (to your Twilio number), we DO NOT dial anything.
//   We just hang up (or you can redirect to voicemail later).
//
// Query params supported:
//   To=+614...
//   lead_id=<uuid>
//   record=1 (default true)

import twilio from "twilio";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function getBaseUrl(req) {
  const env = pickEnv(
    "PUBLIC_BASE_URL",
    "NEXT_PUBLIC_BASE_URL",
    "BASE_URL",
    "TWILIO_WEBHOOK_URL"
  );
  if (env) return String(env).replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function s(v) {
  return String(v ?? "").trim();
}

function normalizePhone(raw) {
  let v = s(raw);
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
  if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9)
    v = "+61" + v.slice(1);
  return v;
}

export default function handler(req, res) {
  try {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    // ---- HARD BLOCK inbound calls hitting this endpoint ----
    // Twilio sends Direction for inbound calls to your Twilio number.
    // If your number's webhook / TwiML app points here, this prevents self-call loops.
    const direction = s(req.body?.Direction || req.query?.Direction);
    if (direction && direction.toLowerCase().includes("inbound")) {
      twiml.say("Goodbye.");
      twiml.hangup();
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml.toString());
    }

    const toRaw = req.query?.To || req.body?.To || "";
    const to = normalizePhone(toRaw);

    const leadId = s(req.query?.lead_id || req.body?.lead_id || "");
    const recordFlag = s(req.query?.record || req.body?.record || "1");
    const shouldRecord = recordFlag !== "0" && recordFlag !== "false";

    // Your Twilio number / caller ID (the one that MUST NOT be dialed)
    const TWILIO_NUMBER = normalizePhone(
      pickEnv("TWILIO_CALLER_ID", "TWILIO_FROM_NUMBER", "TWILIO_FROM", "TWILIO_PHONE_NUMBER")
    );

    // ---- VALIDATION ----
    if (!to || !to.startsWith("+")) {
      twiml.say("Missing or invalid destination number.");
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml.toString());
    }

    // ---- HARD BLOCK: never dial your own Twilio number ----
    // This is the #1 cause of the junk calls you showed (From == To == Twilio number).
    if (TWILIO_NUMBER && normalizePhone(to) === TWILIO_NUMBER) {
      twiml.say("Invalid destination.");
      twiml.hangup();
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml.toString());
    }

    const baseUrl = getBaseUrl(req);

    const recordingCallbackUrl =
      `${baseUrl}/api/twilio/recording-callback?` +
      `lead_id=${encodeURIComponent(leadId || "")}&to=${encodeURIComponent(to)}`;

    const dialOpts = {
      callerId: TWILIO_NUMBER || undefined,
      record: shouldRecord ? "record-from-answer" : undefined,
      recordingStatusCallback: shouldRecord ? recordingCallbackUrl : undefined,
      recordingStatusCallbackMethod: shouldRecord ? "POST" : undefined,
      timeout: 30,
    };

    const dial = twiml.dial(dialOpts);
    dial.number(to);

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (e) {
    console.error("[/api/twilio/voice-client] error:", e);
    return res.status(500).send("TwiML error");
  }
}
