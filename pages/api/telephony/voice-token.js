// /pages/api/telephony/voice-token.js
// FULL REPLACEMENT
//
// ✅ Generates Twilio Voice SDK v2 JWT
// ✅ Uses API Key auth (correct for browser calling)
// ✅ Binds to your TwiML App SID
// ✅ Returns { ok:true, token, identity } (matches your dialer expectations)
//
// ENV REQUIRED:
//   TWILIO_ACCOUNT_SID
//   TWILIO_API_KEY_SID
//   TWILIO_API_KEY_SECRET
//   TWILIO_TWIML_APP_SID

import twilio from "twilio";

function s(v) {
  return String(v ?? "").trim();
}

export default function handler(req, res) {
  try {
    const TWILIO_ACCOUNT_SID = s(process.env.TWILIO_ACCOUNT_SID);
    const TWILIO_API_KEY_SID = s(process.env.TWILIO_API_KEY_SID);
    const TWILIO_API_KEY_SECRET = s(process.env.TWILIO_API_KEY_SECRET);
    const TWILIO_TWIML_APP_SID = s(process.env.TWILIO_TWIML_APP_SID);

    if (
      !TWILIO_ACCOUNT_SID ||
      !TWILIO_API_KEY_SID ||
      !TWILIO_API_KEY_SECRET ||
      !TWILIO_TWIML_APP_SID
    ) {
      return res.status(500).json({
        ok: false,
        error: "Missing Twilio environment variables",
      });
    }

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const grant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    // Use a stable-ish identity so Twilio behaves consistently
    // (still unique per browser tab/session)
    const identity = `gr8-browser-${Date.now()}`;

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      {
        ttl: 3600,
        identity,
      }
    );

    token.addGrant(grant);

    return res.status(200).json({
      ok: true,
      token: token.toJwt(),
      identity,
    });
  } catch (err) {
    console.error("voice-token error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to create voice token",
    });
  }
}
