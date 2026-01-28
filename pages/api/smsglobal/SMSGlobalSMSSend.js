// /pages/api/smsglobal/SMSGlobalSMSSend.js
// FULL REPLACEMENT
//
// ✅ Alias route to keep older frontend calls working.
// ✅ Forwards to /api/smsglobal/SMSSend

import handler from "./SMSSend";

export default function SMSGlobalSMSSendAlias(req, res) {
  return handler(req, res);
}
