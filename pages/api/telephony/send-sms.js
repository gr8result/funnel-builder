// /pages/api/telephony/send-sms.js
import twilio from "twilio";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function must(v, name) {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  try {
    const accountSid = pickEnv("TWILIO_ACCOUNT_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN");
    const fromNumber = pickEnv("TWILIO_FROM_NUMBER", "TWILIO_CALLER_ID", "TWILIO_PHONE_NUMBER");

    const { to, message } = req.body || {};
    const toNumber = String(to || "").trim();
    const body = String(message || "");

    must(accountSid, "TWILIO_ACCOUNT_SID");
    must(authToken, "TWILIO_AUTH_TOKEN");
    must(fromNumber, "TWILIO_FROM_NUMBER (or TWILIO_CALLER_ID)");
    if (!toNumber) return res.status(400).json({ ok: false, error: "Missing 'to' number" });
    if (!body.trim()) return res.status(400).json({ ok: false, error: "Missing 'message'" });

    const client = twilio(accountSid, authToken);

    const msg = await client.messages.create({
      to: toNumber,
      from: fromNumber,
      body,
    });

    return res.status(200).json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    const msg = e?.message || "SMS failed";
    return res.status(500).json({ ok: false, error: msg });
  }
}
