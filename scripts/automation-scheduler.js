// scripts/automation-scheduler.js
// Auto-scheduler for automation flows
// Run this with: node scripts/automation-scheduler.js

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const TICK_INTERVAL = 60000; // 60 seconds
const SEND_INTERVAL = 60000; // 60 seconds

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000';
const CRON_KEY = process.env.AUTOMATION_CRON_SECRET || process.env.AUTOMATION_CRON_KEY || process.env.CRON_SECRET || '';

console.log('[Automation Scheduler] Started');
console.log('[Automation Scheduler] Base URL: ' + BASE_URL);
console.log('[Automation Scheduler] Has CRON_KEY: ' + (CRON_KEY ? 'yes' : 'no (dev mode)'));
console.log('[Automation Scheduler] Tick interval: ' + (TICK_INTERVAL / 1000) + 's');
console.log('[Automation Scheduler] Send interval: ' + (SEND_INTERVAL / 1000) + 's');
console.log('');

async function tickAllFlows() {
  try {
    const response = await fetch(BASE_URL + '/api/automation/cron/tick-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-key': CRON_KEY,
      },
      body: JSON.stringify({ maxFlows: 50, maxPerFlow: 200 }),
    });

    const result = await response.json();
    if (result.ok) {
      console.log('[' + new Date().toLocaleTimeString() + '] TICK: ' + result.processed + ' flows processed');
    } else {
      console.error('[' + new Date().toLocaleTimeString() + '] TICK FAILED: ' + result.error);
    }
  } catch (err) {
    console.error('[' + new Date().toLocaleTimeString() + '] TICK ERROR: ' + err.message);
  }
}

async function sendEmails() {
  try {
    const response = await fetch(BASE_URL + '/api/automation/cron/send-emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-key': CRON_KEY,
      },
      body: JSON.stringify({ max: 100 }),
    });

    const result = await response.json();
    if (result.ok) {
      if (result.sent > 0 || result.failed > 0) {
        console.log('[' + new Date().toLocaleTimeString() + '] SEND: ' + result.sent + ' sent, ' + result.failed + ' failed');
      }
    } else {
      console.error('[' + new Date().toLocaleTimeString() + '] SEND FAILED: ' + result.error);
    }
  } catch (err) {
    console.error('[' + new Date().toLocaleTimeString() + '] SEND ERROR: ' + err.message);
  }
}

async function runCycle() {
  await tickAllFlows();
  await sendEmails();
}

// Run immediately on start
console.log('[Automation Scheduler] Running initial cycle...\n');
runCycle();

// Then run on intervals
setInterval(tickAllFlows, TICK_INTERVAL);
setInterval(sendEmails, SEND_INTERVAL);

// Keep the process alive
process.on('SIGINT', () => {
  console.log('\n[Automation Scheduler] Stopped');
  process.exit(0);
});

console.log('[Automation Scheduler] Running. Press Ctrl+C to stop.\n');

