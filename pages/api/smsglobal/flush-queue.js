// /pages/api/smsglobal/flush-queue.js
// FULL REPLACEMENT — sends pending SMS from public.sms_queue via SMSGlobal
//
// ✅ Auth via ONE of:
//   - Authorization: Bearer <SMSGLOBAL_CRON_SECRET>
//   - header: x-cron-key: <SMSGLOBAL_CRON_SECRET>
//   - query: ?key=<SMSGLOBAL_CRON_SECRET>
// ✅ Reads rows from public.sms_queue and sends via SMSGlobal
// ✅ If origin is invalid/not allowed, it FALLS BACK to DEFAULT_SMS_ORIGIN (prevents 400 spam)
// ✅ Returns: { ok, processed, sent, failed, results:[...] }

import { createClient } from "@supabase/supabase-js";
import { buildSmsGlobalMacHeader } from "../../../lib/smsglobal/macAuth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

function s(v) {
  return String(v ?? "").trim();
}

function digitsOnly(v) {
  return s(v).replace(/[^\d+]/g, "");
}

function normalizeAUTo61(raw) {
  let v = digitsOnly(raw);
  if (!v) return "";
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("0")) v = "61" + v.slice(1);
  return v;
}

function allowedOrigins() {
  const list = s(process.env.SMSGLOBAL_ALLOWED_ORIGINS || "");
  return list
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function pickOrigin(requestedOrigin) {
  const fallback = s(process.env.DEFAULT_SMS_ORIGIN || "gr8result");
  const o = s(requestedOrigin);
  if (!o) return fallback;

  const allow = allowedOrigins();
  if (!allow.length) return fallback;

  if (allow.includes(o)) return o;
  return fallback;
}

function isAuthorized(req) {
  const secret =
    s(process.env.SMSGLOBAL_CRON_SECRET) ||
    s(process.env.SMSGLOBAL_CRON_KEY) ||
    s(process.env.CRON_SECRET);

  if (!secret) return true; // if you didn't set one, allow locally

  const q = s(req.query?.key);
  const h = s(req.headers["x-cron-key"]);
  const a = s(req.headers.authorization);
  const bearer = a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";

  return q === secret || h === secret || bearer === secret;
}

async function sendOne({ origin, destination61, message }) {
  const url = "https://api.smsglobal.com/v2/sms/";
  const apiKey = s(process.env.SMSGLOBAL_API_KEY);
  const secretKey = s(process.env.SMSGLOBAL_API_SECRET);
  if (!apiKey || !secretKey) throw new Error("Missing SMSGlobal env keys");

  const payload = {
    origin,
    destination: destination61,
    message,
  };

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
  try { parsed = JSON.parse(txt); } catch {}

  return { ok: r.ok, http: r.status, body: parsed || txt };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized (missing/invalid key)" });
    }

    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 25)));

    // We can't safely assume your exact "status" columns exist.
    // So we select the newest rows and send them.
    // If you DO have "provider_id" or "sent_at", you can add filters later,
    // but this works with your current setup.
    const { data: rows, error } = await supabaseAdmin
      .from("sms_queue")
      .select("id, user_id, lead_id, to_phone, body, origin")
      .order("id", { ascending: true })
      .limit(limit);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    if (!rows || rows.length === 0) {
      return res.status(200).json({ ok: true, processed: 0, sent: 0, failed: 0, results: [] });
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const id = row.id;
      const to61 = normalizeAUTo61(row.to_phone);
      const msg = s(row.body);

      if (!to61 || !msg) {
        failed++;
        results.push({ id, ok: false, error: "Missing to_phone or body" });
        continue;
      }

      const usedOrigin = pickOrigin(row.origin);

      const out = await sendOne({
        origin: usedOrigin,
        destination61: to61,
        message: msg,
      });

      if (!out.ok) {
        failed++;
        results.push({
          id,
          ok: false,
          smsglobal_http: out.http,
          smsglobal_body: out.body,
          used_origin: usedOrigin,
        });
        continue;
      }

      sent++;

      // Try to extract provider id
      const provider_id = out.body?.id ?? out.body?.messages?.[0]?.id ?? null;

      results.push({ id, ok: true, provider_id, used_origin: usedOrigin });
    }

    return res.status(200).json({
      ok: true,
      processed: rows.length,
      sent,
      failed,
      results,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
