// /pages/api/email/autoresponders/stats.js
// FULL REPLACEMENT
//
// ✅ Returns per-autoresponder stats from email_autoresponder_queue
// ✅ Response shape matches UI open.js expectation: { ok:true, data:[...] }
// ✅ Includes: queued, pending, sent, failed, last_sent_at, opens_total, opens_unique (best effort)
// ✅ AUTH: Bearer token

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;

function safeStr(v) {
  return String(v ?? "").trim();
}

async function getUserFromBearer(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const anon = createClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    { auth: { persistSession: false } }
  );

  const { data } = await anon.auth.getUser(token).catch(() => ({ data: null }));
  return data?.user || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env" });
  }

  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Pull queue rows for this user
  const { data: q, error: qErr } = await supabase
    .from("email_autoresponder_queue")
    .select("autoresponder_id,status,provider_message_id,sent_at")
    .eq("user_id", user.id);

  if (qErr) return res.status(500).json({ ok: false, error: qErr.message });

  const rows = Array.isArray(q) ? q : [];

  // Build stats per autoresponder_id
  const statsBy = new Map(); // arId -> stat object
  const msgToAr = new Map(); // provider_message_id -> arId (for open mapping)

  for (const r of rows) {
    const arId = safeStr(r.autoresponder_id);
    if (!arId) continue;

    if (!statsBy.has(arId)) {
      statsBy.set(arId, {
        autoresponder_id: arId,
        queued: 0,
        pending: 0,
        sent: 0,
        failed: 0,
        last_sent_at: null,
        opens_total: 0,
        opens_unique: 0,
      });
    }

    const st = safeStr(r.status).toLowerCase();
    const stat = statsBy.get(arId);

    if (st === "queued") stat.queued += 1;
    else if (st === "pending" || st === "processing") stat.pending += 1;
    else if (st === "sent") stat.sent += 1;
    else if (st === "failed") stat.failed += 1;

    if (st === "sent" && r.sent_at) {
      const t = new Date(r.sent_at).getTime();
      const cur = stat.last_sent_at ? new Date(stat.last_sent_at).getTime() : 0;
      if (!cur || t > cur) stat.last_sent_at = r.sent_at;
    }

    const pmid = safeStr(r.provider_message_id);
    if (pmid) msgToAr.set(pmid, arId);
  }

  // Best-effort opens: email_events(provider_message_id, event_type='open')
  // If your schema differs or table doesn't exist, opens stays 0.
  try {
    const msgIds = Array.from(msgToAr.keys());
    if (msgIds.length) {
      const { data: ev, error: evErr } = await supabase
        .from("email_events")
        .select("provider_message_id,event_type")
        .in("provider_message_id", msgIds);

      if (!evErr && Array.isArray(ev)) {
        const uniqueOpenMsg = new Set();

        for (const e of ev) {
          const et = safeStr(e.event_type).toLowerCase();
          if (et !== "open") continue;

          const pmid = safeStr(e.provider_message_id);
          const arId = msgToAr.get(pmid);
          if (!arId) continue;

          const stat = statsBy.get(arId);
          if (!stat) continue;

          stat.opens_total += 1;

          if (!uniqueOpenMsg.has(pmid)) {
            uniqueOpenMsg.add(pmid);
            stat.opens_unique += 1;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  const data = Array.from(statsBy.values());

  return res.status(200).json({ ok: true, data });
}
