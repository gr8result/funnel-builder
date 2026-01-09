// /pages/api/smsglobal/flush-queue.js
// FULL REPLACEMENT — SAFE SCHEDULING DEFAULT (due-only)
//
// ✅ DEFAULT: sends ONLY rows where scheduled_for <= now
// ✅ mode=all: overrides and sends all queued immediately (danger)
// ✅ Retries + stuck recovery
// ✅ Uses your working endpoint /api/smsglobal/SMSGlobalSMSSend
//
// GET /api/smsglobal/flush-queue?limit=50
// Optional: ?mode=all (DANGER: ignores scheduled_for)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    const e = new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    e.missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => {
      if (k === "SUPABASE_URL") {
        return !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL;
      }
      return !process.env.SUPABASE_SERVICE_ROLE_KEY;
    });
    throw e;
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getBaseUrl(req) {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (envUrl) return envUrl.replace(/\/+$/, "");

  const proto =
    s(req.headers["x-forwarded-proto"]) ||
    (req.socket?.encrypted ? "https" : "http") ||
    "http";
  const host =
    s(req.headers["x-forwarded-host"]) || s(req.headers.host) || "localhost:3000";
  return `${proto}://${host}`;
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return { ok: true, json: JSON.parse(text), text };
  } catch {
    return { ok: false, json: null, text };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(sendUrl, payload, maxAttempts = 3) {
  let lastErr = null;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const resp = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const parsed = await safeJson(resp);
      const data = parsed.json;

      if (!resp.ok || !data?.ok) {
        lastErr =
          s(data?.error) ||
          s(data?.detail) ||
          s(parsed.text) ||
          `Send failed (HTTP ${resp.status})`;
      } else {
      const provider_message_id =
        data?.provider_message_id || data?.provider_id || data?.message_id || data?.id || null;
        return { ok: true, provider_message_id };
      }
    } catch (e) {
      lastErr = s(e?.message || e);
    }

    if (i < maxAttempts) await sleep(250 + i * 500);
  }

  return { ok: false, error: lastErr || "Unknown send error" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" });
  }

  try {
    const sb = admin();

    const limitRaw = Number(req.query?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    // SAFE DEFAULT: due-only
    const mode = s(req.query?.mode || "due").toLowerCase();
    const sendAll = mode === "all";

    const nowIso = new Date().toISOString();

    const baseUrl = getBaseUrl(req);
    const sendUrl = `${baseUrl}/api/smsglobal/SMSGlobalSMSSend`;

    // 1) Load rows
    let q = sb
      .from("sms_queue")
      .select("id, to_phone, body, scheduled_for, status")
      .eq("status", "queued")
      .order("scheduled_for", { ascending: true })
      .limit(limit);

    if (!sendAll) q = q.lte("scheduled_for", nowIso);

    const { data: rows, error: selErr } = await q;

    if (selErr) {
      return res.status(500).json({
        ok: false,
        error: "Failed to load queue",
        detail: selErr.message || String(selErr),
      });
    }

    if (!rows?.length) {
      return res.status(200).json({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        mode: sendAll ? "all" : "due",
        now: nowIso,
        message: sendAll
          ? "No queued rows."
          : "No DUE queued rows (scheduled_for is in the future).",
      });
    }

    // 2) Lock rows (queued -> sending)
    const ids = rows.map((r) => r.id);

    const { data: locked, error: lockErr } = await sb
      .from("sms_queue")
      .update({ status: "sending" })
      .in("id", ids)
      .eq("status", "queued")
      .select("id, to_phone, body");

    if (lockErr) {
      return res.status(500).json({
        ok: false,
        error: "Failed to lock queue rows",
        detail: lockErr.message || String(lockErr),
      });
    }

    const lockedRows = locked || [];
    if (!lockedRows.length) {
      return res.status(200).json({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        mode: sendAll ? "all" : "due",
        now: nowIso,
        message: "No rows locked (already processed).",
      });
    }

    // 3) Send
    let sent = 0;
    let failed = 0;
    const results = [];

    for (const row of lockedRows) {
      const id = row.id;
      const to = s(row.to_phone);
      const message = s(row.body);

      if (!to || !message) {
        failed++;
        const errText = "Missing to_phone or body";
        results.push({ id, ok: false, error: errText });
        await sb.from("sms_queue").update({ status: "failed", error: errText }).eq("id", id);
        continue;
      }

      const sendRes = await sendWithRetry(sendUrl, { to, message }, 3);

      if (sendRes.ok) {
        sent++;
        results.push({ id, ok: true, provider_message_id: sendRes.provider_message_id || null });
        await sb
          .from("sms_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_message_id: sendRes.provider_message_id || null,
            error: null,
          })
          .eq("id", id);
      } else {
        failed++;
        const errText = s(sendRes.error);
        results.push({ id, ok: false, error: errText });
        await sb.from("sms_queue").update({ status: "failed", error: errText }).eq("id", id);
      }
    }

    return res.status(200).json({
      ok: true,
      processed: lockedRows.length,
      sent,
      failed,
      mode: sendAll ? "all" : "due",
      now: nowIso,
      sendUrl,
      results,
      warning: sendAll
        ? "mode=all ignores scheduled_for and will send everything immediately."
        : null,
    });
  } catch (err) {
    console.error("flush-queue error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: err?.message || String(err),
      missing: err?.missing || null,
    });
  }
}
