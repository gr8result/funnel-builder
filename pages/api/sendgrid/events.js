// /pages/api/sendgrid/events.js

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const WEBHOOK_SECRET = (process.env.SENDGRID_EVENT_WEBHOOK_SECRET || "").trim();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function json(res, status, payload) {
  res.status(status).json(payload);
}

function verifySignature(req, rawBody) {
  // If you are NOT using SendGrid signed webhook, leave secret blank.
  if (!WEBHOOK_SECRET) return true;

  const sig = String(req.headers["x-twilio-email-event-webhook-signature"] || "");
  const ts = String(req.headers["x-twilio-email-event-webhook-timestamp"] || "");
  if (!sig || !ts) return false;

  const payload = ts + rawBody;
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("base64");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const config = {
  api: { bodyParser: { sizeLimit: "5mb" } },
};

export default async function handler(req, res) {
  try {
    // ✅ Browser test
    if (req.method === "GET") {
      return json(res, 200, { ok: true, endpoint: "/api/sendgrid/events" });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(res, 500, { ok: false, error: "Missing SUPABASE_URL/SERVICE_KEY env vars" });
    }

    const rawBody = JSON.stringify(req.body || []);
    if (!verifySignature(req, rawBody)) {
      return json(res, 401, { ok: false, error: "Invalid webhook signature" });
    }

    const events = Array.isArray(req.body) ? req.body : [];
    if (!events.length) return json(res, 200, { ok: true, inserted: 0 });

    const rows = events.map((ev) => {
      const custom = ev?.custom_args || ev?.customArgs || {};
      return {
        provider: "sendgrid",
        event: String(ev?.event || ""),
        email: String(ev?.email || ""),
        timestamp: ev?.timestamp
          ? new Date(Number(ev.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        sg_event_id: ev?.sg_event_id ? String(ev.sg_event_id) : null,
        sg_message_id: ev?.sg_message_id ? String(ev.sg_message_id) : null,

        // these will be populated once your sender includes custom_args
        flow_id: custom?.flow_id ? String(custom.flow_id) : null,
        node_id: custom?.node_id ? String(custom.node_id) : null,
        run_id: custom?.run_id ? String(custom.run_id) : null,
        user_id: custom?.user_id ? String(custom.user_id) : null,
        lead_id: custom?.lead_id ? String(custom.lead_id) : null,
        email_id: custom?.email_id ? String(custom.email_id) : null,

        url: ev?.url ? String(ev.url) : null,
        reason: ev?.reason ? String(ev.reason) : null,
        raw: ev,
      };
    });

    const { error } = await supabaseAdmin.from("email_events").insert(rows);
    if (error) return json(res, 500, { ok: false, error: error.message || "Insert failed" });

    return json(res, 200, { ok: true, inserted: rows.length });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e?.message || e || "Unknown error") });
  }
}
