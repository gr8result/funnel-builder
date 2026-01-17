// /pages/api/telephony/voice-token.js
// FULL REPLACEMENT
//
// ✅ Endpoint: /api/telephony/voice-token
// ✅ Stable identity (default "browser-user") so Twilio can ring the browser
// ✅ incomingAllow: true so the browser device can receive calls
//
// Requires env:
//  TWILIO_ACCOUNT_SID
//  TWILIO_API_KEY_SID
//  TWILIO_API_KEY_SECRET
//  TWILIO_TWIML_APP_SID
//
// Optional:
//  TWILIO_IDENTITY_PREFIX (default "gr8")

import twilio from "twilio";

export default async function handler(req, res) {
  try {
    const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
    const apiKeySid = String(process.env.TWILIO_API_KEY_SID || "").trim();
    const apiKeySecret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();
    const appSid = String(process.env.TWILIO_TWIML_APP_SID || "").trim();

    const missing = [];
    if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!apiKeySid) missing.push("TWILIO_API_KEY_SID");
    if (!apiKeySecret) missing.push("TWILIO_API_KEY_SECRET");
    if (!appSid) missing.push("TWILIO_TWIML_APP_SID");

    if (missing.length) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars", missing });
    }

    const prefix = String(process.env.TWILIO_IDENTITY_PREFIX || "gr8").trim();

    // ✅ MUST be stable if you want the browser to ring
    // Default to browser-user to match make-call
    const rawIdentity = (req.query?.identity ? String(req.query.identity) : "").trim();
    const identity = rawIdentity || "browser-user";

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity: identity.startsWith(prefix) ? identity : identity, // keep as-is; do NOT randomize
      ttl: 3600,
    });

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: appSid,
        incomingAllow: true, // ✅ IMPORTANT: allow Twilio to ring this identity
      })
    );

    return res.status(200).json({
      ok: true,
      token: token.toJwt(),
      identity,
    });
  } catch (e) {
    console.error("[/api/telephony/voice-token] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
