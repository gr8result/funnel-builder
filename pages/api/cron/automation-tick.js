// /pages/api/cron/automation-tick.js
// FULL REPLACEMENT
//
// ✅ Single endpoint your cron can hit every minute
// ✅ Calls the SAME logic as /api/automation/engine/tick by just re-running it here
// ✅ Optional query passthrough: flow_id, limit, force
//
// GET /api/cron/automation-tick?flow_id=...&limit=50&force=1

import tick from "../automation/engine/tick";

export default async function handler(req, res) {
  // Reuse the tick handler directly
  return tick(req, res);
}
