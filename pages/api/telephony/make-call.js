// /pages/api/telephony/make-call.js
// FULL REPLACEMENT
//
// ✅ Calls your Twilio Voice SDK client (default client:browser-user)
// ✅ TwiML served by /api/twilio/voice-client?To=+614...
// ✅ Cleans PUBLIC_BASE_URL so it can’t become "http --domain=..."
// ✅ Prevents invalid URL errors
//
// Env required:
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN
// - TWILIO_CALLER_ID (your Twilio number, E.164 e.g. +61...)
// Optional env (recommended):
// - PUBLIC_BASE_URL (your ngrok URL, e.g. https://xxxx.ngrok-free.dev)

import twilio from "twilio";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function cleanBaseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Extract the first http(s)://... substring
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (!m) return "";
  return m[0].replace(/\/+$/, "");
}

function getBaseUrl(req) {
  const envRaw = pickEnv("PUBLIC_BASE_URL", "NEXT_PUBLIC_BASE_URL", "BASE_URL", "TWILIO_WEBHOOK_URL");
  const env = cleanBaseUrl(envRaw);
  if (env) return env;

  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function normalizePhone(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
  if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);
  return v;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const accountSid = pickEnv("TWILIO_ACCOUNT_SID", "TWILIO_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN", "TWILIO_TOKEN");
    const callerId = pickEnv("TWILIO_CALLER_ID", "TWILIO_FROM_NUMBER", "TWILIO_FROM");

    if (!accountSid || !authToken) {
      return res.status(500).json({
        ok: false,
        error: "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN",
      });
    }
    if (!callerId || !callerId.startsWith("+")) {
      return res.status(500).json({
        ok: false,
        error: "Missing/invalid TWILIO_CALLER_ID (must be E.164 +...)",
      });
    }

    const rawTo = req.body?.to ?? "";
    const to = normalizePhone(rawTo);

    if (!to) return res.status(400).json({ ok: false, error: "Missing 'to' phone number" });
    if (!to.startsWith("+")) return res.status(400).json({ ok: false, error: "Phone must be E.164 (+61...)" });

    const identity = String(req.body?.client_identity || "browser-user").trim() || "browser-user";
    const clientTo = `client:${identity}`;

    const baseUrl = getBaseUrl(req);
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return res.status(500).json({
        ok: false,
        error:
          "PUBLIC_BASE_URL is not set to a valid http(s) URL. Set PUBLIC_BASE_URL to your ngrok URL like https://xxxx.ngrok-free.dev",
        baseUrl,
      });
    }

    // Always include ?To= so voice-client never errors
    const twimlUrl = `${baseUrl}/api/twilio/voice-client?To=${encodeURIComponent(to)}&record=1`;

    const client = twilio(accountSid, authToken);

    const call = await client.calls.create({
      to: clientTo,     // ring the browser client
      from: callerId,   // your Twilio number
      url: twimlUrl,    // TwiML dials the real number and bridges audio
      method: "POST",
    });

    return res.status(200).json({
      ok: true,
      sid: call.sid,
      to,
      client_to: clientTo,
      twiml_url: twimlUrl,
      base_url: baseUrl,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to create call.",
    });
  }
}
