// /pages/api/twilio/send-sms.js
// 🔁 Backwards-compatible SMS endpoint.
// We are NOT using Twilio for SMS anymore.
// This file simply proxies to the SMSGlobal handler so any old
// frontend code that still posts to `/api/twilio/send-sms` keeps working.

import smsGlobalHandler from "../telephony/send-sms";

export default function handler(req, res) {
  // Delegate completely to the SMSGlobal implementation
  return smsGlobalHandler(req, res);
}
