// /pages/api/telephony/voice-token.js
// FULL REPLACEMENT
//
// ✅ Endpoint: /api/telephony/voice-token
// ✅ Works with your calls.js (identity passed in querystring)
// ✅ Sets outgoingApplicationSid correctly
// ✅ incomingAllow: true (safe) so the Device can register cleanly
// ✅ Adds explicit pushCredentialSid support (optional) WITHOUT breaking anything
// ✅ Fixes identity handling (prefix was unused / broken)
//
// Requires env:
//  TWILIO_ACCOUNT_SID
//  TWILIO_API_KEY_SID
//  TWILIO_API_KEY_SECRET
//  TWILIO_TWIML_APP_SID
//
// Optional:
//  TWILIO_IDENTITY_PREFIX (default "gr8")   // only used to sanitize/namespace
//  TWILIO_PUSH_CREDENTIAL_SID               // only needed for mobile push (not browser)

import twilio from "twilio";

function s(v) {
  return String(v ?? "").trim();
}

function safeIdentity(raw, prefix) {
  // Keep it simple and Twilio-safe: letters/numbers/_-.
  // Also keep it reasonably short.
  let id = s(raw) || "browser-user";
  id = id.replace(/[^a-zA-Z0-9_\-:.]/g, "-");
  if (id.length > 120) id = id.slice(0, 120);

  // If you want a namespace, ensure it starts with prefix-
  const p = s(prefix) || "gr8";
  if (!id.startsWith(`${p}-`)) {
    // BUT: don’t double-prefix if identity already includes user/tab
    // We only prefix if identity is the plain default.
    if (id === "browser-user") id = `${p}-browser-user`;
  }

  return id;
}

export default async function handler(req, res) {
  try {
    const accountSid = s(process.env.TWILIO_ACCOUNT_SID);
    const apiKeySid = s(process.env.TWILIO_API_KEY_SID);
    const apiKeySecret = s(process.env.TWILIO_API_KEY_SECRET);
    const appSid = s(process.env.TWILIO_TWIML_APP_SID);

    const missing = [];
    if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!apiKeySid) missing.push("TWILIO_API_KEY_SID");
    if (!apiKeySecret) missing.push("TWILIO_API_KEY_SECRET");
    if (!appSid) missing.push("TWILIO_TWIML_APP_SID");

    if (missing.length) {
      return res.status(500).json({
        ok: false,
        error: "Missing Twilio env vars",
        missing,
      });
    }

    const prefix = s(process.env.TWILIO_IDENTITY_PREFIX) || "gr8";

    // identity comes from calls.js:
    // /api/telephony/voice-token?identity=...
    const rawIdentity = s(req.query?.identity);
    const identity = safeIdentity(rawIdentity, prefix);

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600,
    });

<<<<<<< HEAD
    const pushCredentialSid = s(process.env.TWILIO_PUSH_CREDENTIAL_SID);

    // IMPORTANT:
    // For the browser Voice SDK, incomingAllow can be true; it does NOT force inbound calls
    // unless you actually route calls to that client identity. It DOES help registration be consistent.
    // Outgoing is controlled by the TwiML App SID.
    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: appSid,
        incomingAllow: true,
        ...(pushCredentialSid ? { pushCredentialSid } : {}),
      })
    );
=======
token.addGrant(
  new VoiceGrant({
    outgoingApplicationSid: appSid,
    incomingAllow: false, // ✅ FIX: browser can place calls, not receive them
  })
);

>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

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
