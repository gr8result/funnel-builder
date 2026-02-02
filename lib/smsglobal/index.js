// /lib/smsglobal/index.js
// FULL REPLACEMENT
//
// Simple shared helper for SMSGlobal sending.
// We are using ONE shared pool origin for all users (DEFAULT_SMS_ORIGIN).
//
// Env required:
// - SMSGLOBAL_API_KEY
// - SMSGLOBAL_API_SECRET
// - DEFAULT_SMS_ORIGIN (example: "gr8result" or "Gr8 Result")

import { buildSmsGlobalMacHeader } from "./macAuth";

function s(v) {
  return String(v ?? "").trim();
}

function digitsOnly(v) {
  return s(v).replace(/[^\d+]/g, "");
}

// Convert AU numbers into SMSGlobal format like 614xxxxxxxx (no +)
export function normalizeAUTo61(raw) {
  let v = digitsOnly(raw);
  if (!v) return "";
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("0")) v = "61" + v.slice(1);
  return v;
}

export async function sendSmsGlobal({ toPhone, message, origin }) {
  const url = "https://api.smsglobal.com/v2/sms/";

  const apiKey = s(process.env.SMSGLOBAL_API_KEY);
  const secretKey = s(process.env.SMSGLOBAL_API_SECRET);
  if (!apiKey || !secretKey) throw new Error("Missing SMSGlobal env keys");

  // Allow any origin (user_id) as sender
  // Force to pre-approved sender for SMSGlobal compatibility
  const safeOrigin = s(process.env.DEFAULT_SMS_ORIGIN || "GR8RESULT");
  const payload = {
    origin: safeOrigin,
    destination: normalizeAUTo61(toPhone),
    message: s(message),
  };

  if (!payload.destination) throw new Error("Missing/invalid to_phone");
  if (!payload.message) throw new Error("Missing body/message");
  if (!payload.origin) throw new Error("Missing origin (sender)");

  const { header } = buildSmsGlobalMacHeader({
    apiKey,
    secretKey,
    method: "POST",
    url,
  });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: header,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const txt = await r.text();
  let parsed = null;
  try {
    parsed = JSON.parse(txt);
  } catch {}

  return {
    ok: r.ok,
    http: r.status,
    body: parsed || txt,
    used_origin: safeOrigin,
    destination: payload.destination,
    warning: (!r.ok && parsed && parsed.error) ? parsed.error : undefined,
  };
}
