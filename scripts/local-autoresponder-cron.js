// /scripts/local-autoresponder-cron.js
// Local autoresponder queue runner for development
// Run: node scripts/local-autoresponder-cron.js
// It calls the autoresponder processor every 5 minutes.

const WORKER_URL = "http://localhost:3000/api/email/autoresponders/process-queue";
const CRON_SECRET = "c1ae7bf64e1173572ebddde70789919bf457975eae044dc1413654e5ac524645";
const INTERVAL_MINUTES = 5;

async function tick() {
  const ts = new Date().toLocaleTimeString();
  try {
    const res = await fetch(`${WORKER_URL}?key=${CRON_SECRET}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const raw = await res.text();
    if (!res.ok) {
      console.log(`[${ts}] Autoresponder tick -> ${res.status} ERROR: ${raw}`);
      return;
    }

    const data = JSON.parse(raw);
    console.log(`[${ts}] Autoresponder tick -> Processed: ${data.processed}, Sent: ${data.sent}, Failed: ${data.failed}`);
  } catch (e) {
    console.log(`[${ts}] Autoresponder tick -> FETCH ERROR: ${e?.message || e}`);
  }
}

console.log(`Local autoresponder runner started (every ${INTERVAL_MINUTES} minutes)`);
console.log(`Calling: ${WORKER_URL}?key=${CRON_SECRET}`);

// Run immediately, then every INTERVAL_MINUTES
tick();
setInterval(tick, INTERVAL_MINUTES * 60 * 1000);