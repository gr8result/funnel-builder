// scripts/automation-scheduler.js
// FULL REPLACEMENT
//
// Runs forever:
// - tick-all (advances runs, queues emails)
// - flush-queue (sends queued emails)
//
// Usage:
//   1) npm run dev  (in Terminal 1)
//   2) node scripts/automation-scheduler.js  (in Terminal 2)
//
// Requires .env.local:
//   AUTOMATION_CRON_SECRET (or AUTOMATION_CRON_KEY / CRON_SECRET)

require("dotenv").config({ path: ".env.local" });


const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "http://localhost:3000";

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const TICK_INTERVAL_SEC = Number(process.env.AUTOMATION_TICK_INTERVAL_SEC || 60);
const SEND_INTERVAL_SEC = Number(process.env.AUTOMATION_SEND_INTERVAL_SEC || 60);

function headers() {
  return {
    "Content-Type": "application/json",
    ...(CRON_SECRET ? { "x-cron-key": CRON_SECRET } : {}),
  };
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body || {}),
  });
  const text = await r.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { ok: false, error: "No JSON", raw: text.slice(0, 400) };
  }
  return { status: r.status, json };
}

async function tickAll() {
  return postJson(`${BASE_URL}/api/automation/cron/tick-all`, { maxFlows: 50, maxPerFlow: 200 });
}

async function flushQueue() {
  return postJson(`${BASE_URL}/api/automation/email/flush-queue?limit=25`, {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async function main() {
  console.log("[Automation Scheduler] Started");
  console.log("[Automation Scheduler] Base URL:", BASE_URL);
  console.log("[Automation Scheduler] Has CRON key:", !!CRON_SECRET);
  console.log("[Automation Scheduler] Tick interval:", TICK_INTERVAL_SEC, "s");
  console.log("[Automation Scheduler] Send interval:", SEND_INTERVAL_SEC, "s");

  let lastTick = 0;
  let lastSend = 0;

  while (true) {
    const now = Date.now();

    if (now - lastTick >= TICK_INTERVAL_SEC * 1000) {
      lastTick = now;
      const out = await tickAll();
      if (out.status >= 200 && out.status < 300 && out.json?.ok) {
        console.log(`[${new Date().toLocaleTimeString()}] TICK OK:`, out.json?.processed ?? out.json);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] TICK FAILED (${out.status}):`, out.json);
      }
    }

    if (now - lastSend >= SEND_INTERVAL_SEC * 1000) {
      lastSend = now;
      const out = await flushQueue();
      if (out.status >= 200 && out.status < 300 && out.json?.ok) {
        console.log(
          `[${new Date().toLocaleTimeString()}] SEND OK: sent=${out.json?.sent || 0} failed=${out.json?.failed || 0}`
        );
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] SEND FAILED (${out.status}):`, out.json);
      }
    }

    await sleep(500);
  }
})();
