// /pages/api/cron/automation-tick.js
// FULL REPLACEMENT
//
// ✅ GET or POST
// ✅ Just reuses /api/automation/engine/tick handler
//
// /api/cron/automation-tick?flow_id=...&limit=50&force=1

import tick from "../automation/engine/tick";

export default async function handler(req, res) {
  // allow GET/POST; tick itself will validate params
  return tick(req, res);
}
