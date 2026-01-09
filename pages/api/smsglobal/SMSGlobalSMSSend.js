// /pages/api/smsglobal/SMSGlobalSMSSend.js
// FULL REPLACEMENT — single SMS send via SMSGlobal MAC auth + LOG INTO sms_queue
//
// ✅ Derives user from Bearer token (so it’s tied to the logged in user)
// ✅ Sends SMS via SMSGlobal
// ✅ Inserts a row into sms_queue AFTER send (so you SEE it in Supabase again)
// ✅ Ensures lead_id is NOT NULL by creating/finding a lead for the destination number

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SMSGLOBAL_API_KEY = process.env.SMSGLOBAL_API_KEY;
const SMSGLOBAL_API_SECRET = process.env.SMSGLOBAL_API_SECRET;
const SMSGLOBAL_FROM = process.env.SMSGLOBAL_FROM || process.env.SMSGLOBAL_ORIGIN || "";

function s(v) {
  return String(v ?? "").trim();
}

function getBearer(req) {
  const h = s(req.headers?.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return s(h.slice(7));
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function digitsOnly(v) {
  return s(v).replace(/[^\d]/g, "");
}

function normalizeToDigitsOrFail(v) {
  // accept +61..., 0417..., 61...
  const raw = s(v);
  if (!raw) return "";
  let x = raw.replace(/[^\d+]/g, "");
  if (x.startsWith("+")) x = x.slice(1);
  if (x.startsWith("0") && x.length >= 9) x = "61" + x.slice(1);
  return digitsOnly(x);
}

function normalizeToE164(v) {
  const raw = s(v);
  if (!raw) return "";
  let x = raw.replace(/[^\d+]/g, "");
  if (x.startsWith("+")) x = x.slice(1);
  if (x.startsWith("0") && x.length >= 9) x = "61" + x.slice(1);
  if (x.startsWith("61")) return "+" + x;
  if (/^\d+$/.test(x)) return "+" + x;
  return "";
}

function macAuthHeader({ method, url }) {
  const apiKey = s(SMSGLOBAL_API_KEY);
  const secret = s(SMSGLOBAL_API_SECRET);

  if (!apiKey || !secret) {
    const e = new Error("Missing SMSGLOBAL_API_KEY or SMSGLOBAL_API_SECRET");
    e.missing = ["SMSGLOBAL_API_KEY", "SMSGLOBAL_API_SECRET"].filter((k) => !process.env[k]);
    throw e;
  }

  const ts = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 10000000);

  const u = new URL(url);
  const host = u.hostname;
  const port = u.port ? Number(u.port) : u.protocol === "http:" ? 80 : 443;
  const pathPlusQuery = u.pathname + (u.search || "");

  const auth =
    ts +
    "\n" +
    nonce +
    "\n" +
    method.toUpperCase() +
    "\n" +
    pathPlusQuery +
    "\n" +
    host +
    "\n" +
    port +
    "\n" +
    "\n";

  const mac = crypto.createHmac("sha256", secret).update(auth).digest("base64");
  return `MAC id="${apiKey}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
}

async function sendViaSmsGlobal({ to, message }) {
  const url = "https://api.smsglobal.com/v2/sms";

  const headers = {
    "Content-Type": "application/json",
    Authorization: macAuthHeader({ method: "POST", url }),
  };

  const body = {
    destination: s(to),
    message: s(message),
  };

  if (s(SMSGLOBAL_FROM)) body.origin = s(SMSGLOBAL_FROM);

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!r.ok) return { ok: false, status: r.status, raw: text, json };
  return { ok: true, status: r.status, raw: text, json };
}

async function ensureLeadForPhone(sb, uid, phoneE164) {
  const phone = s(phoneE164);
  if (!phone) return null;

  const { data: existing, error: exErr } = await sb
    .from("leads")
    .select("id")
    .eq("user_id", uid)
    .or(`phone.eq.${phone},mobile.eq.${phone}`)
    .limit(1)
    .maybeSingle();

  if (!exErr && existing?.id) return existing;

  const { data: created, error: crErr } = await sb
    .from("leads")
    .insert([{ user_id: uid, name: phone, phone }], { count: "exact" })
    .select("id")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message || String(crErr));
  return created || null;
}

async function logToSmsQueue(sb, { uid, lead_id, to_phone, body, provider_message_id }) {
  const nowIso = new Date().toISOString();

  // Prefer full schema
  const fullRow = {
    user_id: uid,
    lead_id,
    step_no: 1,
    to_phone,
    body,
    scheduled_for: nowIso,
    status: "sent",
    provider_message_id: provider_message_id || null,
    sent_at: nowIso,
  };

  const tryFull = await sb.from("sms_queue").insert([fullRow], { count: "exact" });
  if (!tryFull.error) return { ok: true };

  const msg = String(tryFull.error?.message || "").toLowerCase();
  const looksMissingCol = msg.includes("column") && msg.includes("does not exist");
  if (!looksMissingCol) return { ok: false, error: tryFull.error };

  // Minimal fallback
  const minRow = {
    user_id: uid,
    lead_id,
    step_no: 1,
    to_phone,
    body,
  };

  const tryMin = await sb.from("sms_queue").insert([minRow], { count: "exact" });
  if (!tryMin.error) return { ok: true };
  return { ok: false, error: tryMin.error };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST" });
    }

    const sb = admin();

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session token" });
    }
    const uid = userData.user.id;

    const toRaw = s(req.body?.to);
    const message = s(req.body?.message);

    const toDigits = normalizeToDigitsOrFail(toRaw);
    if (!toDigits || !/^\d{8,15}$/.test(toDigits)) {
      return res.status(400).json({ ok: false, error: "Invalid destination number." });
    }
    if (!message) {
      return res.status(400).json({ ok: false, error: "Message is empty." });
    }

    const toE164 = normalizeToE164(toRaw);
    if (!toE164) {
      return res.status(400).json({ ok: false, error: "Invalid destination number." });
    }

    const r = await sendViaSmsGlobal({ to: toDigits, message });

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "SMS failed.",
        detail: r.raw || "",
        status: r.status,
      });
    }

    const provider_id = r.json?.messages?.[0]?.id || r.json?.id || null;

    // Ensure lead exists (sms_queue.lead_id is NOT NULL in your schema)
    const lead = await ensureLeadForPhone(sb, uid, toE164);
    if (!lead?.id) {
      return res.status(500).json({ ok: false, error: "Failed to create/find lead for SMS logging." });
    }

    // Log into sms_queue so you see it again
    const log = await logToSmsQueue(sb, {
      uid,
      lead_id: lead.id,
      to_phone: toE164,
      body: message,
      provider_message_id: provider_id,
    });

    if (!log.ok) {
      return res.status(500).json({
        ok: false,
        error: "SMS sent but failed to log into sms_queue.",
        detail: log.error?.message || String(log.error),
      });
    }

    return res.status(200).json({
      ok: true,
      provider: "smsglobal",
      provider_id,
      raw: r.raw || "",
    });
  } catch (err) {
    console.error("SMSGlobalSMSSend error:", err);
    return res.status(500).json({
      ok: false,
      error: "SMS failed.",
      detail: err?.message || String(err),
      missing: err?.missing || null,
    });
  }
}
