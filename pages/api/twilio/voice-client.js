// /pages/api/twilio/voice-client.js
// FULL REPLACEMENT
//
// ✅ Fixes "Missing destination number" (reads To from query OR POST body)
// ✅ Fixes Twilio error 31214 ("valid callerId must be provided") by setting <Dial callerId="...">
// ✅ Supports outbound recording (record=1)
// ✅ Sends statusCallback to /api/twilio/callback-status (your existing file)
// ✅ Passes lead_id along (as query param to status callback)
//
// ENV REQUIRED:
//   PUBLIC_BASE_URL (or TWILIO_WEBHOOK_URL for ngrok)
//   TWILIO_CALLER_ID   (MUST be your Twilio number, E.164, e.g. +61468048115)
// Optional:
//   DEFAULT_COUNTRY=AU (not required)
//
// IMPORTANT:
// - TWILIO_CALLER_ID must be a Twilio-owned (or verified) caller ID enabled for outbound.
// - This is what fixes the hangup after ~1 ring.

export const config = {
  api: { bodyParser: true }, // Twilio often POSTs x-www-form-urlencoded
};

function s(v) {
  return String(v ?? "").trim();
}

function escapeXml(v) {
  return s(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pickFirst(...vals) {
  for (const v of vals) {
    const t = s(v);
    if (t) return t;
  }
  return "";
}

function normalizePhone(raw) {
  let v = s(raw);
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
  if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);
  return v;
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = req.body || {};

    // Destination number can arrive in query OR body, and sometimes in different keys.
    const rawTo = pickFirst(q.To, b.To, q.to, b.to, q.phone, b.phone, q.destination, b.destination);
    const to = normalizePhone(rawTo);

    // REQUIRED caller ID for PSTN calls from Twilio Client
    const callerIdRaw = pickFirst(
      process.env.TWILIO_CALLER_ID,
      process.env.TWILIO_CALLERID,
      process.env.TWILIO_FROM_NUMBER
    );
    const callerId = normalizePhone(callerIdRaw);

    const leadId = pickFirst(q.lead_id, b.lead_id, q.leadId, b.leadId);
    const record = pickFirst(q.record, b.record, "1") === "1";

    const base = pickFirst(process.env.PUBLIC_BASE_URL, process.env.TWILIO_WEBHOOK_URL);
    const statusCallbackBase = base ? `${base}/api/twilio/callback-status` : "";

    // Validate
    if (!to) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Missing destination number.</Say>
</Response>`
      );
    }

    if (!callerId) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Missing caller ID.</Say>
</Response>`
      );
    }

    // Build status callback URL (include lead_id if present)
    const statusCallback =
      statusCallbackBase && leadId
        ? `${statusCallbackBase}?lead_id=${encodeURIComponent(s(leadId))}`
        : statusCallbackBase;

    // Dial attributes
    const dialAttrs = [];
    dialAttrs.push(`callerId="${escapeXml(callerId)}"`); // ✅ THIS FIXES 31214
    if (record) dialAttrs.push(`record="record-from-answer"`);
    if (statusCallback) {
      dialAttrs.push(`statusCallback="${escapeXml(statusCallback)}"`);
      dialAttrs.push(`statusCallbackMethod="POST"`);
      dialAttrs.push(`statusCallbackEvent="initiated ringing answered completed"`);
    }

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial ${dialAttrs.join(" ")}>
    <Number>${escapeXml(to)}</Number>
  </Dial>
</Response>`
    );
  } catch (e) {
    console.error("voice-client error:", e);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Server error.</Say>
</Response>`
    );
  }
}
