import { createClient } from "@supabase/supabase-js";
import { sendSmsGlobal } from "../../../lib/smsglobal/index.js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const DEFAULT_SMS_ORIGIN = (process.env.DEFAULT_SMS_ORIGIN || "gr8result").trim();

const SMSGLOBAL_ALLOWED_ORIGINS = String(
  process.env.SMSGLOBAL_ALLOWED_ORIGINS || ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const CRON_SECRET = process.env.CRON_SECRET || process.env.AUTOMATION_CRON_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function json(res, status, body) {
  return res.status(status).json(body);
}

function normalizePhone(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");

  // Strip leading + if present
  if (v.startsWith("+")) v = v.slice(1);

  // AU normalisation: convert 0XXXXXXXXX to 61XXXXXXXXX
  if (v.startsWith("0") && v.length >= 9) v = "61" + v.slice(1);

  // Ensure it starts with 61 (AU country code)
  if (!v.startsWith("61")) {
    // If it's already just digits without country code, assume AU
    if (/^\d{9,}$/.test(v)) v = "61" + v;
  }

  return v;
}

function pickOrigin(rowOrigin) {
  // Prefer the row value
  if (s(rowOrigin)) return s(rowOrigin);
  // Then any allowed from env, then default
  if (SMSGLOBAL_ALLOWED_ORIGINS.length) {
    if (SMSGLOBAL_ALLOWED_ORIGINS.includes(DEFAULT_SMS_ORIGIN)) return DEFAULT_SMS_ORIGIN;
    return SMSGLOBAL_ALLOWED_ORIGINS[0];
  }
  return DEFAULT_SMS_ORIGIN;
}

function parseTime(v) {
  if (!v) return NaN;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function getEarliestScheduledTime(row) {
  // Use all possible scheduling fields, prefer earliest
  const times = [
    row?.scheduled_for,
    row?.scheduled_at,
    row?.available_at,
    row?.send_at,
    row?.run_at,
  ]
    .map(parseTime)
    .filter((t) => Number.isFinite(t));
  if (!times.length) return 0; // No schedule means due now!
  return Math.min(...times);
}

function isDueNow(row, nowMs) {
  // Only due if earliest schedule date/time is in the past or now
  return getEarliestScheduledTime(row) <= nowMs;
}

function getRowToPhone(row) {
  return (
    normalizePhone(row?.to_phone) ||
    normalizePhone(row?.to) ||
    normalizePhone(row?.phone) ||
    normalizePhone(row?.destination) ||
    ""
  );
}

function getRowMessage(row) {
  return s(row?.body) || s(row?.message) || s(row?.text) || "";
}

function getRowId(row) {
  return row?.id;
}

async function updateRow(supabaseAdmin, id, patch) {
  // Try variants so we survive minor schema differences
  const variants = [
    patch,
    {
      ...patch,
      provider_message_id: patch.provider_message_id ?? patch.provider_id,
      provider_id: patch.provider_id ?? patch.provider_message_id,
      last_error: patch.last_error ?? patch.error,
      error: patch.error ?? patch.last_error,
    },
  ];

  let lastErr = null;
  for (const p of variants) {
    const up = await supabaseAdmin.from("sms_queue").update(p).eq("id", id);
    if (!up.error) return { ok: true };
    lastErr = up.error;
  }
  return { ok: false, error: lastErr };
}

async function getUserFromBearer(req, supabaseAnon) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function hasValidKey(req) {
  const key = s(req.query?.key);
  if (!CRON_SECRET) return false;
  return key && key === CRON_SECRET;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) {
    return json(res, 500, { ok: false, error: "Missing Supabase env" });
  }

  const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const keyMode = hasValidKey(req);

  // If not keyMode, require Bearer user
  let user = null;
  if (!keyMode) {
    user = await getUserFromBearer(req, supabaseAnon);
    if (!user) {
      return json(res, 401, { ok: false, error: "Unauthorized (missing/invalid Bearer token)" });
    }
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
  const dry = String(req.query.dry || "").trim() === "1";

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  // Pull a batch of rows, then filter due in JS (schema-safe)
  // Key mode = all users; Bearer mode = this user only.
  let q = supabaseAdmin
    .from("sms_queue")
    .select("*")
    .order("id", { ascending: true })
    .limit(limit * 10);

  if (!keyMode && user?.id) {
    q = q.eq("user_id", user.id);
  }

  const read = await q;

  if (read.error) {
    return json(res, 500, {
      ok: false,
      error: "Failed to read sms_queue",
      detail: read.error.message,
    });
  }

  const all = Array.isArray(read.data) ? read.data : [];

  // Pending statuses
  const pending = all.filter((r) => {
    const st = s(r?.status).toLowerCase();
    const alreadySent = !!s(r?.sent_at) || !!s(r?.provider_message_id) || !!s(r?.provider_id);
    if (alreadySent) return false;
    return !st || st === "queued" || st === "pending" || st === "ready";
  });

  // Only send messages that are due now or earlier
  const due = pending.filter((r) => isDueNow(r, nowMs)).slice(0, limit);

  if (dry) {
    return json(res, 200, {
      ok: true,
      dry: true,
      now: nowIso,
      key_mode: keyMode,
      pending_found: pending.length,
      due_found: due.length,
      sample_ids: due.slice(0, 20).map((r) => r.id),
    });
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const row of due) {
    processed++;

    const id = getRowId(row);
    const to = getRowToPhone(row);
    const message = getRowMessage(row);
    const origin = pickOrigin(row?.origin);

    if (!id || !to || !message) {
      failed++;
      results.push({ id: id ?? null, ok: false, error: "Row missing id/to/message" });
      continue;
    }

    await updateRow(supabaseAdmin, id, { status: "sending", last_error: null, error: null });

    try {
      const out = await sendSmsGlobal({
        toPhone: to,
        message,
        origin,
      });

      // Extract provider_id from response body
      const provider_id =
        (Array.isArray(out.body?.messages) && out.body.messages[0]?.id) ||
        out.body?.messageId ||
        out.body?.id ||
        "";

      if (!out.ok) {
        failed++;

        await updateRow(supabaseAdmin, id, {
          status: "failed",
          last_error: `SMSGlobal HTTP ${out.http}`,
          error: JSON.stringify(out.body || {}),
          smsglobal_http: out.http,
        });

        // Log failed send to sms_sends
        await supabaseAdmin.from("sms_sends").insert({
          user_id: row.user_id || null,
          queue_id: id,
          phone: to,
          message,
          origin,
          status: "failed",
          sent_at: null,
          failed_at: nowIso,
          provider_id: provider_id || null,
          delivery_status: "failed",
          last_error: `SMSGlobal HTTP ${out.http}`,
          error_message: JSON.stringify(out.body || {}),
          created_at: nowIso,
        });

        results.push({
          id,
          ok: false,
          error: "SMSGlobal request failed",
          smsglobal_http: out.http,
          detail: out.body || {},
        });
        continue;
      }

      sent++;

      await updateRow(supabaseAdmin, id, {
        status: "sent",
        sent_at: nowIso,
        provider_message_id: provider_id || "",
        provider_id: provider_id || "",
        last_error: null,
        error: null,
      });

      // Log successful send to sms_sends
      await supabaseAdmin.from("sms_sends").insert({
        user_id: row.user_id || null,
        queue_id: id,
        phone: to,
        message,
        origin,
        status: "sent",
        sent_at: nowIso,
        failed_at: null,
        provider_id: provider_id || null,
        delivery_status: "delivered", // optimistic, update later if webhooks supported
        last_error: null,
        error_message: null,
        created_at: nowIso,
      });

      results.push({ id, ok: true, provider_id: provider_id || "" });
    } catch (e) {
      failed++;

      await updateRow(supabaseAdmin, id, {
        status: "failed",
        last_error: e?.message || "Send failed",
        error: e?.message || "Send failed",
      });

      // Log error to sms_sends
      await supabaseAdmin.from("sms_sends").insert({
        user_id: row.user_id || null,
        queue_id: id,
        phone: to,
        message,
        origin,
        status: "failed",
        sent_at: null,
        failed_at: nowIso,
        provider_id: null,
        delivery_status: "failed",
        last_error: e?.message || "Send failed",
        error_message: e?.message || "Send failed",
        created_at: nowIso,
      });

      results.push({ id, ok: false, error: e?.message || "Send failed" });
    }
  }

  return json(res, 200, {
    ok: true,
    key_mode: keyMode,
    now: nowIso,
    pending_found: pending.length,
    due_found: due.length,
    processed,
    sent,
    failed,
    results,
  });
}