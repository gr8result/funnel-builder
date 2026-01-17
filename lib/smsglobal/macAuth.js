// /lib/smsglobal/macAuth.js
// FULL REPLACEMENT — single source of truth for SMSGlobal MAC auth
// Exports BOTH function names so NOTHING breaks:
//  - buildSmsGlobalMacHeader (older name)
//  - macAuthHeaderWarningFree (newer name)

import crypto from "crypto";

function s(v) {
  return String(v ?? "").trim();
}

/**
 * Build SMSGlobal MAC Authorization header.
 * Returns { header, ts, nonce, mac, authString, host, port, pathWithQuery }
 */
export function buildSmsGlobalMacHeader({ apiKey, secretKey, method, url }) {
  const key = s(apiKey);
  const secret = s(secretKey);

  if (!key) throw new Error("Missing SMSGLOBAL_API_KEY");
  if (!secret) throw new Error("Missing SMSGLOBAL_API_SECRET");

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString("hex");

  const u = new URL(url);
  const host = u.hostname;
  const port = u.port ? String(u.port) : u.protocol === "http:" ? "80" : "443";

  // Important: path + query exactly
  const pathWithQuery = `${u.pathname}${u.search || ""}`;

  // Format:
  // ts \n nonce \n method \n path+query \n host \n port \n \n
  const authString = `${ts}\n${nonce}\n${s(method).toUpperCase()}\n${pathWithQuery}\n${host}\n${port}\n\n`;

  const mac = crypto.createHmac("sha256", secret).update(authString).digest("base64");
  const header = `MAC id="${key}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;

  return { header, ts, nonce, mac, authString, host, port, pathWithQuery };
}

/**
 * Old helper name used elsewhere in your code.
 * Reads env vars and returns just the Authorization string.
 */
export function macAuthHeaderWarningFree({ method, url }) {
  const key = s(process.env.SMSGLOBAL_API_KEY);
  const secret = s(process.env.SMSGLOBAL_API_SECRET);

  if (!key || !secret) {
    return `MAC id="missing", ts="${Date.now()}", nonce="missing", mac="missing"`;
  }

  const { header } = buildSmsGlobalMacHeader({
    apiKey: key,
    secretKey: secret,
    method,
    url,
  });

  return header;
}
