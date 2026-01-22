// /pages/api/smsglobal/flush-queue.js
// FULL REPLACEMENT
//
// ✅ Pulls due rows from public.sms_queue and sends them via SMSGlobal
// ✅ Secure with key if SMSGLOBAL_CRON_SECRET / SMSGLOBAL_CRON_KEY set
<<<<<<< HEAD
// ✅ AUTO-HANDLES unknown sms_queue schemas (message/to/send_after column names differ)
// ✅ Avoids schema-cache crashes by retrying select mappings
//
// NOTE: If SMSGlobal returns 403, this file will report the provider response body.
=======
// ✅ Handles missing "origin" column (schema cache error) gracefully
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const SMSGLOBAL_API_KEY = (process.env.SMSGLOBAL_API_KEY || "").trim();
const SMSGLOBAL_API_SECRET = (process.env.SMSGLOBAL_API_SECRET || "").trim();

const CRON_SECRET =
  (process.env.SMSGLOBAL_CRON_SECRET || "").trim() ||
  (process.env.SMSGLOBAL_CRON_KEY || "").trim();

const DEFAULT_SMS_ORIGIN = (process.env.DEFAULT_SMS_ORIGIN || "gr8result").trim();

function s(v) {
  return String(v ?? "").trim();
}

function sanitizeOrigin(origin) {
  let o = s(origin);
  if (!o) return "";
  o = o.replace(/[^a-zA-Z0-9]/g, "");
  if (o.length > 11) o = o.slice(0, 11);
  return o;
}

async function sendSmsGlobal({ to, message, origin }) {
<<<<<<< HEAD
  const url = "https://api.smsglobal.com/v2/sms/";

  const payload = {
    destination: s(to),
    message: s(message),
=======
  // SMSGlobal REST API v2 (common pattern). If your account uses a different endpoint,
  // your existing working code already matches it — keep that in place.
  const url = "https://api.smsglobal.com/v2/sms/";

  const payload = {
    destination: to,
    message,
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
  };

  const o = sanitizeOrigin(origin);
  if (o) payload.origin = o;

  const auth = Buffer.from(`${SMSGLOBAL_API_KEY}:${SMSGLOBAL_API_SECRET}`).toString("base64");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    return {
      ok: false,
      http: resp.status,
      body: data,
    };
  }

<<<<<<< HEAD
  const provider_id = data?.messages?.[0]?.id || data?.id || null;
=======
  // provider id is usually in messages[0].id or similar
  const provider_id =
    data?.messages?.[0]?.id ||
    data?.id ||
    null;
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)

  return {
    ok: true,
    provider_id,
    body: data,
  };
<<<<<<< HEAD
}

async function readDueQueueRows(supabase, limit, nowIso) {
  const messageCols = ["message", "sms_message", "body", "content", "text"];
  const toCols = ["to", "phone", "destination"];
  const timeCols = ["send_after", "scheduled_at", "scheduled_for", "available_at"];

  let lastErr = null;

  for (const msgCol of messageCols) {
    for (const toCol of toCols) {
      for (const timeCol of timeCols) {
        // Select only columns we KNOW exist by trial.
        const sel = `id,user_id,lead_id,provider_id,error,created_at,updated_at,status,${toCol},${msgCol},${timeCol}`;

        const { data, error } = await supabase
          .from("sms_queue")
          .select(sel)
          .in("status", ["pending", "retry"])
          .lte(timeCol, nowIso)
          .order(timeCol, { ascending: true })
          .limit(limit);

        if (!error) {
          return {
            ok: true,
            rows: data || [],
            mapping: { msgCol, toCol, timeCol },
          };
        }

        lastErr = error;
      }
    }
  }

  return { ok: false, error: lastErr?.message || "Failed to read sms_queue" };
=======
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  }
  if (!SMSGLOBAL_API_KEY || !SMSGLOBAL_API_SECRET) {
    return res.status(500).json({ ok: false, error: "Missing SMSGlobal env" });
  }

  // Auth (only if secret is set)
  if (CRON_SECRET) {
    const key =
      s(req.query.key) ||
      s(req.headers["x-cron-key"]) ||
      (s(req.headers.authorization).startsWith("Bearer ")
        ? s(req.headers.authorization).slice(7)
        : "");

    if (key !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized (missing/invalid key)" });
    }
<<<<<<< HEAD
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const limit = Math.min(Number(req.query.limit || 25) || 25, 100);
  const nowIso = new Date().toISOString();

  const got = await readDueQueueRows(supabase, limit, nowIso);
  if (!got.ok) {
    return res.status(500).json({ ok: false, error: "Failed to read sms_queue", detail: got.error });
  }

  const { rows, mapping } = got;
  const msgCol = mapping.msgCol;
  const toCol = mapping.toCol;

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const row of rows || []) {
    processed++;

    const to = s(row?.[toCol]);
    const message = s(row?.[msgCol]);
    const used_origin = sanitizeOrigin(DEFAULT_SMS_ORIGIN) || "gr8result";

    const resp = await sendSmsGlobal({ to, message, origin: used_origin });

    if (resp.ok) {
      sent++;

      const upd = await supabase
        .from("sms_queue")
        .update({
          status: "done",
          provider_id: resp.provider_id,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.push({
        id: row.id,
        ok: true,
        provider_id: resp.provider_id,
        used_origin,
        db_ok: !upd.error,
      });
    } else {
      failed++;

      await supabase
        .from("sms_queue")
        .update({
          status: "failed",
          error: JSON.stringify(resp.body || { http: resp.http }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.push({
        id: row.id,
        ok: false,
        used_origin,
        smsglobal_http: resp.http,
        smsglobal_body: resp.body,
      });
    }
  }

  return res.status(200).json({
    ok: true,
    mapping_used: mapping,
=======
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const limit = Math.min(Number(req.query.limit || 25) || 25, 100);
  const nowIso = new Date().toISOString();

  // IMPORTANT: do not select "origin" explicitly (caused schema cache errors for you).
  const { data: rows, error } = await supabase
    .from("sms_queue")
    .select("id,user_id,lead_id,to,message,status,send_after,provider_id,error,created_at")
    .in("status", ["pending", "retry"])
    .lte("send_after", nowIso)
    .order("send_after", { ascending: true })
    .limit(limit);

  if (error) {
    return res.status(500).json({ ok: false, error: "Failed to read sms_queue", detail: error.message });
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const row of rows || []) {
    processed++;

    // origin: try to read from row.meta if you store it, else fallback env
    const used_origin = sanitizeOrigin(DEFAULT_SMS_ORIGIN) || "gr8result";

    const resp = await sendSmsGlobal({
      to: s(row.to),
      message: s(row.message),
      origin: used_origin,
    });

    if (resp.ok) {
      sent++;
      // update row -> done
      const upd = await supabase
        .from("sms_queue")
        .update({
          status: "done",
          provider_id: resp.provider_id,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.push({
        id: row.id,
        ok: true,
        provider_id: resp.provider_id,
        used_origin: used_origin,
        db_ok: !upd.error,
      });
    } else {
      failed++;
      await supabase
        .from("sms_queue")
        .update({
          status: "failed",
          error: JSON.stringify(resp.body || { http: resp.http }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.push({
        id: row.id,
        ok: false,
        used_origin: used_origin,
        smsglobal_http: resp.http,
        smsglobal_body: resp.body,
      });
    }
  }

  return res.status(200).json({
    ok: true,
>>>>>>> 524cfe9 (WIP: autoresponder + automation + sms fixes)
    processed,
    sent,
    failed,
    results,
  });
}
