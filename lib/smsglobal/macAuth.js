// /lib/smsglobal/macAuth.js
// FULL REPLACEMENT — SMSGlobal MAC Authorization header builder
//
// ✅ Exports BOTH names so nothing breaks:
//    - buildSmsGlobalMacHeader (used by your APIs)
//    - macAuthHeaderWarningFree (legacy name)
// ✅ Uses env keys when using macAuthHeaderWarningFree()

import crypto from "crypto";

function s(v) {
  return String(v ?? "").trim();
}

export function buildSmsGlobalMacHeader({ apiKey, secretKey, method, url }) {
  if (!apiKey) throw new Error("Missing SMSGLOBAL_API_KEY");
  if (!secretKey) throw new Error("Missing SMSGLOBAL_API_SECRET");

  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");

  const u = new URL(url);
  const host = u.hostname;
  const port = u.port ? Number(u.port) : u.protocol === "http:" ? 80 : 443;

  // Important: path + query exactly
  const pathWithQuery = `${u.pathname}${u.search || ""}`;

  // MAC base string format:
  // ts \n nonce \n method \n request-uri \n host \n port \n \n
  const base = `${ts}\n${nonce}\n${s(method || "POST").toUpperCase()}\n${pathWithQuery}\n${host}\n${port}\n\n`;

  const mac = crypto.createHmac("sha256", secretKey).update(base).digest("base64");

  const header = `MAC id="${apiKey}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;

  return { header, ts, nonce, mac, base, host, port, pathWithQuery };
}

// Legacy-compatible helper (uses env internally)
export function macAuthHeaderWarningFree({ method, url }) {
  const apiKey = s(process.env.SMSGLOBAL_API_KEY);
  const secretKey = s(process.env.SMSGLOBAL_API_SECRET);
  if (!apiKey || !secretKey) {
    return `MAC id="missing", ts="${Date.now()}", nonce="missing", mac="missing"`;
  }
  return buildSmsGlobalMacHeader({ apiKey, secretKey, method, url }).header;
}
