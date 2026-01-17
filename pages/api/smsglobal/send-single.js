// /pages/api/smsglobal/send-single.js
// FULL REPLACEMENT — Single SMS endpoint that DOES NOT require a Supabase Bearer token
//
// POST { to, message }
// ✅ Uses the SAME server creds as SMSGlobalSMSSend
// ✅ Fixes your UI error “Missing Bearer token” because we don’t require it here

function s(v) {
  return String(v ?? "").trim();
}

function normalizeAuE164(raw) {
  let v = s(raw);
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (v.startsWith("+")) return v;
  if (v.startsWith("0") && v.length >= 9 && v.length <= 11) return `+61${v.slice(1)}`;
  return v;
}

function getBasicAuth() {
  const key =
    s(process.env.SMSGLOBAL_API_KEY) ||
    s(process.env.SMSGLOBAL_KEY) ||
    s(process.env.SMSGLOBAL_USERNAME);

  const secret =
    s(process.env.SMSGLOBAL_API_SECRET) ||
    s(process.env.SMSGLOBAL_SECRET) ||
    s(process.env.SMSGLOBAL_PASSWORD);

  if (!key || !secret) return "";
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const to = normalizeAuE164(req.body?.to || req.body?.to_phone);
  const message = s(req.body?.message || req.body?.body);

  if (!to || !message) return res.status(400).json({ ok: false, error: "Missing {to,message}" });

  const auth = getBasicAuth();
  if (!auth) {
    return res.status(500).json({
      ok: false,
      error: "Missing SMSGlobal credentials",
      detail: "Set SMSGLOBAL_API_KEY and SMSGLOBAL_API_SECRET then restart server.",
    });
  }

  const origin =
    s(process.env.SMSGLOBAL_ORIGIN) ||
    s(process.env.SMSGLOBAL_FROM) ||
    s(process.env.SMS_FROM) ||
    "";

  const url = "https://api.smsglobal.com/v2/sms/";
  const payload = { destination: to, message, ...(origin ? { origin } : {}) };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(payload),
  });

  const parsed = await safeJson(resp);

  if (!resp.ok) {
    return res.status(resp.status).json({
      ok: false,
      error: "SMSGlobal send failed",
      detail:
        s(parsed.json?.message) ||
        s(parsed.json?.error) ||
        s(parsed.json?.errors?.[0]?.message) ||
        s(parsed.text) ||
        `HTTP ${resp.status}`,
      raw: parsed.json || parsed.text,
    });
  }

  const data = parsed.json;
  const provider_message_id =
    data?.messages?.[0]?.id ||
    data?.messages?.[0]?.messageId ||
    data?.id ||
    data?.message_id ||
    data?.messageId ||
    null;

  return res.status(200).json({ ok: true, provider_message_id, raw: data });
}
