// /pages/api/smsglobal/ping.js
// FULL REPLACEMENT — validates SMSGlobal creds using GET /v2/user/credit-balance
//
// ✅ Reads creds from SMSGLOBAL_API_KEY/SMSGLOBAL_API_SECRET OR SMSGLOBAL_KEY/SMSGLOBAL_SECRET

import crypto from "crypto";

function s(v) {
  return String(v ?? "").trim();
}

function baseUrl() {
  return (process.env.SMSGLOBAL_BASE_URL || "https://api.smsglobal.com").replace(/\/+$/, "");
}

function getCreds() {
  const key = s(process.env.SMSGLOBAL_API_KEY) || s(process.env.SMSGLOBAL_KEY);
  const secret = s(process.env.SMSGLOBAL_API_SECRET) || s(process.env.SMSGLOBAL_SECRET);
  return { key, secret };
}

function getMacHeader({ key, secret, method, path, host, port }) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString("hex");

  const normalized = [
    ts,
    nonce,
    method.toUpperCase(),
    path,
    host,
    String(port),
    "",
    "",
  ].join("\n");

  const mac = crypto.createHmac("sha256", secret).update(normalized).digest("base64");

  return `MAC id="${key}",ts="${ts}",nonce="${nonce}",mac="${mac}"`;
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return { ok: true, json: JSON.parse(text), text };
  } catch {
    return { ok: false, json: null, text };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });

  try {
    const { key, secret } = getCreds();
    if (!key || !secret) {
      return res.status(500).json({
        ok: false,
        error: "Missing SMSGlobal credentials",
        missing: [
          !key ? "SMSGLOBAL_API_KEY(or SMSGLOBAL_KEY)" : null,
          !secret ? "SMSGLOBAL_API_SECRET(or SMSGLOBAL_SECRET)" : null,
        ].filter(Boolean),
      });
    }

    const url = new URL(`${baseUrl()}/v2/user/credit-balance`);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : 443;
    const path = url.pathname;

    const auth = getMacHeader({ key, secret, method: "GET", path, host, port });

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: auth },
    });

    const parsed = await safeJson(resp);
    const data = parsed.json;

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        smsglobal_http: resp.status,
        smsglobal_ok: false,
        smsglobal_body: data ?? parsed.text,
      });
    }

    return res.status(200).json({
      ok: true,
      smsglobal_http: resp.status,
      smsglobal_ok: true,
      credit_balance: data ?? null,
    });
  } catch (e) {
    console.error("smsglobal ping error:", e);
    return res.status(500).json({ ok: false, error: "Server error", detail: e?.message || String(e) });
  }
}
