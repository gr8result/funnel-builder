import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config({ path: ".env.local" });

dotenv.config();

const { supabaseAdmin } = await import("../utils/supabase-admin.js");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (!SENDGRID_API_KEY) {
  console.error("Missing SENDGRID_API_KEY in environment.");
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

const parseBool = (val) => String(val).toLowerCase() === "true" || val === "1" || val === "yes";

const sinceArg = getArg("since");
const untilArg = getArg("until");
const dryRun = parseBool(getArg("dry-run"));
const limit = Number(getArg("limit") || 500);
const allowEmailFallback = parseBool(getArg("email-fallback"));

const toIso = (value) => {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const since = sinceArg ? new Date(sinceArg) : daysAgo(60);
const until = untilArg ? new Date(untilArg) : new Date();

if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
  console.error("Invalid --since or --until date. Use YYYY-MM-DD or ISO.");
  process.exit(1);
}

const sinceTs = Math.floor(since.getTime() / 1000);
const untilTs = Math.floor(until.getTime() / 1000);

// SendGrid Messages API doesn't support custom queries, just use pagination
const query = null;
const baseUrl = "https://api.sendgrid.com/v3/messages";

const sgGet = async (url) => {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid API error ${res.status}: ${body}`);
  }
  return res.json();
};

const normalizeMsgId = (msg) => msg?.msg_id || msg?.sg_message_id || msg?.message_id || msg?.id || null;

const pickEventType = (raw) => {
  const t = String(raw || "").toLowerCase();
  if (t === "open") return "opened";
  if (t === "click") return "clicked";
  if (t === "delivered" || t === "processed") return "delivered";
  if (t === "bounce" || t === "dropped") return "bounced";
  if (t === "unsubscribe" || t === "group_unsubscribe") return "unsubscribe";
  return t || null;
};

const updateRow = async (rowId, updates) => {
  if (dryRun) return true;
  const { error } = await supabaseAdmin.from("email_sends").update(updates).eq("id", rowId);
  if (error) throw error;
  return true;
};

let totalMessages = 0;
let matched = 0;
let updated = 0;
let skipped = 0;

const processMessage = async (msg) => {
  totalMessages += 1;
  const msgId = normalizeMsgId(msg);
  const toEmail = msg?.to_email || msg?.email || msg?.to || null;

  let details = null;
  if (msgId) {
    try {
      details = await sgGet(`${baseUrl}/${encodeURIComponent(msgId)}`);
    } catch (err) {
      console.warn(`Failed to fetch details for ${msgId}: ${err.message}`);
    }
  }

  const events = Array.isArray(details?.events) ? details.events : [];
  let openCount = 0;
  let clickCount = 0;
  let deliveredAt = null;
  let lastEvent = null;
  let lastEventAt = null;

  for (const ev of events) {
    const evType = String(ev?.event || ev?.event_name || ev?.type || "").toLowerCase();
    const evTime = toIso(ev?.timestamp || ev?.event_timestamp || ev?.occurred_at || ev?.created_at || ev?.time);
    if (evType === "open") openCount += 1;
    if (evType === "click") clickCount += 1;
    if (evType === "delivered" || evType === "processed") {
      if (!deliveredAt || (evTime && evTime < deliveredAt)) deliveredAt = evTime;
    }
    if (evTime && (!lastEventAt || evTime > lastEventAt)) {
      lastEventAt = evTime;
      lastEvent = evType;
    }
  }

  const msgOpen = Number(msg?.opens || msg?.open_count || msg?.stats?.opens || 0);
  const msgClick = Number(msg?.clicks || msg?.click_count || msg?.stats?.clicks || 0);
  openCount = Math.max(openCount, msgOpen);
  clickCount = Math.max(clickCount, msgClick);

  if (!lastEventAt) lastEventAt = toIso(msg?.last_event_time || msg?.last_event_at);
  if (!lastEvent) lastEvent = msg?.last_event || msg?.status || null;

  let matchedRow = null;
  if (msgId) {
    const { data } = await supabaseAdmin
      .from("email_sends")
      .select("id, open_count, click_count, last_event_at, delivered_at, status")
      .or(`sendgrid_message_id.eq.${msgId},sg_message_id.eq.${msgId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    matchedRow = data || null;
  }

  if (!matchedRow && allowEmailFallback && toEmail) {
    const matchTime = lastEventAt || toIso(msg?.created_at || msg?.sent_at);
    let q = supabaseAdmin
      .from("email_sends")
      .select("id, open_count, click_count, last_event_at, delivered_at, status, created_at")
      .eq("email", toEmail)
      .order("created_at", { ascending: false })
      .limit(1);
    if (matchTime) q = q.lte("created_at", matchTime);
    const { data } = await q.maybeSingle();
    matchedRow = data || null;
  }

  if (!matchedRow) {
    skipped += 1;
    return;
  }

  matched += 1;

  const updates = {};
  const currentOpen = Number(matchedRow.open_count || 0);
  const currentClick = Number(matchedRow.click_count || 0);

  if (openCount > currentOpen) updates.open_count = openCount;
  if (clickCount > currentClick) updates.click_count = clickCount;

  if (deliveredAt && !matchedRow.delivered_at) updates.delivered_at = deliveredAt;

  if (lastEventAt && (!matchedRow.last_event_at || new Date(lastEventAt) > new Date(matchedRow.last_event_at))) {
    updates.last_event_at = lastEventAt;
    if (lastEvent) updates.last_event = lastEvent;
    const statusFromEvent = pickEventType(lastEvent);
    if (statusFromEvent) updates.status = statusFromEvent;
  }

  if (Object.keys(updates).length === 0) return;

  await updateRow(matchedRow.id, updates);
  updated += 1;
};

const run = async () => {
  console.log("Backfill started", {
    since: since.toISOString(),
    until: until.toISOString(),
    dryRun,
    limit,
    allowEmailFallback,
  });

  let next = null;
  let page = 0;

  while (true) {
    const url = next
      ? `${baseUrl}?limit=${limit}&next=${encodeURIComponent(next)}`
      : `${baseUrl}?limit=${limit}`;

    const data = await sgGet(url);
    const messages = data?.messages || data?.results || [];

    page += 1;
    console.log(`Page ${page}: ${messages.length} messages`);

    let countInRange = 0;
    for (const msg of messages) {
      // For now, process all messages (date filtering is best-effort)
      countInRange += 1;
      await processMessage(msg);
    }

    // If no messages in range and we have pages, might need more pages to find messages in range
    // But if page is mostly outside range, we're done
    if (countInRange === 0 && page > 1) break;

    next = data?.next || null;
    if (!next) break;
  }

  console.log("Backfill done", { totalMessages, matched, updated, skipped, dryRun });
};

run().catch((err) => {
  console.error("Backfill failed:", err.message || err);
  process.exit(1);
});
