// /pages/api/smsglobal/flush-queue.js
// FULL REPLACEMENT
//
// ✅ Option B (recommended): CRON key access for server/cron/browser calls
//    GET /api/smsglobal/flush-queue?key=<CRON_SECRET>&limit=50
//
// ✅ Option A (still supported): Bearer token access
//    POST /api/smsglobal/flush-queue?limit=50
//    Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
//
// ✅ Sends queued sms_queue rows via SMSGlobal
// ✅ Updates: status + sent_at + provider_message_id/provider_id + last_error/error
// ✅ Handles your schema: scheduled_for + available_at + provider_message_id + last_error
// ✅ Works with integer sms_queue.id
// ✅ Uses shared sendSmsGlobal from lib/smsglobal/index.js for proper MAC auth
//
// Query params:
//   limit=50 (default 25, max 200)
//   dry=1    (no sends, just reports due rows)
//
// ENV required:
//   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY / SUPABASE_SERVICE)
//
//   SMSGLOBAL_API_KEY
//   SMSGLOBAL_API_SECRET (or SMSGLOBAL_API_SECRET / SMSGLOBAL_API_SECRET)
//   DEFAULT_SMS_ORIGIN (optional)
//   SMSGLOBAL_ALLOWED_ORIGINS (optional comma list)
//   CRON_SECRET (or AUTOMATION_CRON_KEY)  <-- Option B key

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

function pickOrigin() {
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

function isDueNow(row, nowMs) {
  // includes YOUR scheduled_for
  const candidates = [
    row?.scheduled_for,
    row?.scheduled_at,
    row?.available_at,
    row?.send_at,
    row?.run_at,
  ]
    .map(parseTime)
    .filter((t) => Number.isFinite(t));

  if (!candidates.length) return true;
  return Math.min(...candidates) <= nowMs;
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
  return row?.id; // integer in your table
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
  // Allow GET (cron/browser) + POST (api client)
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

  const due = pending.filter((r) => isDueNow(r, nowMs)).slice(0, limit);

  // Fast report for dry mode
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

    if (!id || !to || !message) {
      failed++;
      results.push({ id: id ?? null, ok: false, error: "Row missing id/to/message" });
      continue;
    }

    // mark sending
    await updateRow(supabaseAdmin, id, { status: "sending", last_error: null, error: null });

    try {
      const out = await sendSmsGlobal({
        toPhone: to,
        message,
        origin: s(row?.origin) || pickOrigin(),
      });

      if (!out.ok) {
        failed++;

        await updateRow(supabaseAdmin, id, {
          status: "failed",
          last_error: `SMSGlobal HTTP ${out.http}`,
          error: JSON.stringify(out.body || {}),
          smsglobal_http: out.http,
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

      // Extract provider_id from response body
      const provider_id = 
        (Array.isArray(out.body?.messages) && out.body.messages[0]?.id) ||
        out.body?.messageId ||
        out.body?.id ||
        "";

      await updateRow(supabaseAdmin, id, {
        status: "sent",
        sent_at: nowIso,
        provider_message_id: provider_id || "",
        provider_id: provider_id || "",
        last_error: null,
        error: null,
      });

      results.push({ id, ok: true, provider_id: provider_id || "" });
    } catch (e) {
      failed++;

      await updateRow(supabaseAdmin, id, {
        status: "failed",
        last_error: e?.message || "Send failed",
        error: e?.message || "Send failed",
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
