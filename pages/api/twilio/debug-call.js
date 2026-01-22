// /pages/api/twilio/debug-call.js
// FULL REPLACEMENT
//
// ✅ Returns Twilio call status + errorCode for a CallSid
//
// Auth options (either):
//  A) TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
//  B) TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET
//
// Query:
//  ?sid=CAxxxx

import twilio from "twilio";

function s(v) {
  return String(v ?? "").trim();
}

export default async function handler(req, res) {
  try {
    const accountSid = s(process.env.TWILIO_ACCOUNT_SID);
    const authToken = s(process.env.TWILIO_AUTH_TOKEN);

    const apiKeySid = s(process.env.TWILIO_API_KEY_SID);
    const apiKeySecret = s(process.env.TWILIO_API_KEY_SECRET);

    if (!accountSid) {
      return res.status(500).json({ ok: false, error: "Missing TWILIO_ACCOUNT_SID" });
    }

    const sid = s(req.query?.sid);
    if (!sid || !sid.startsWith("CA")) {
      return res.status(400).json({ ok: false, error: "Missing/invalid sid" });
    }

    // Prefer Auth Token if present, otherwise use API Key pair
    let client = null;
    if (authToken) {
      client = twilio(accountSid, authToken);
    } else if (apiKeySid && apiKeySecret) {
      client = twilio(apiKeySid, apiKeySecret, { accountSid });
    } else {
      return res.status(500).json({
        ok: false,
        error: "Missing Twilio auth: need TWILIO_AUTH_TOKEN OR (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)",
      });
    }

    const call = await client.calls(sid).fetch();

    return res.status(200).json({
      ok: true,
      call: {
        sid: call.sid,
        status: call.status,
        direction: call.direction,
        from: call.from,
        to: call.to,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration,
        errorCode: call.errorCode ?? null,
      },
    });
  } catch (e) {
    console.error("[/api/twilio/debug-call] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
