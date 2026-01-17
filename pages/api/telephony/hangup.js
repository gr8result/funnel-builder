// /pages/api/telephony/hangup.js
// FULL REPLACEMENT (new file)
//
// ✅ Hangs up a live Twilio call by SID
//
// POST body: { sid: "CAxxxxxxxx..." }
//
// Required env:
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN

import twilio from "twilio";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const accountSid = pickEnv("TWILIO_ACCOUNT_SID", "TWILIO_SID");
  const authToken = pickEnv("TWILIO_AUTH_TOKEN", "TWILIO_TOKEN");
  if (!accountSid || !authToken) {
    return res.status(500).json({ ok: false, error: "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN" });
  }

  const sid = String(req.body?.sid || "").trim();
  if (!sid || !sid.startsWith("CA")) {
    return res.status(400).json({ ok: false, error: "Missing or invalid call sid" });
  }

  try {
    const client = twilio(accountSid, authToken);
    const updated = await client.calls(sid).update({ status: "completed" });
    return res.status(200).json({ ok: true, sid: updated.sid, status: updated.status });
  } catch (e) {
    console.error("[/api/telephony/hangup] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Failed to hang up call." });
  }
}
