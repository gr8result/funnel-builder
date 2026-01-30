// /pages/api/webhooks/sendgrid-events.js
// Full replacement file — SendGrid Event Webhook receiver with Ed25519 signature verification.
// - Uses your existing server admin client (utils/supabase-admin.js) -- no new createClient here.
// - Inserts an audit row into public.sendgrid_events
// - Deduplicates by sg_event_id
// - Matches email_sends by (1) custom_args.gr8_send_row_id, (2) sendgrid_message_id, (3) latest send for that email before event time
// - Safely increments open_count / click_count and sets last_event / last_event_at, delivered_at, bounced_at, unsubscribed, and sendgrid_message_id when available
// - Expects SENDGRID_SIGNING_KEY env var (SendGrid public key, base64) to verify signatures.
//
// Required server env vars:
//   SUPABASE_SERVICE_ROLE_KEY (already used by your utils/supabase-admin.js)
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL per your admin client file)
//   SENDGRID_SIGNING_KEY (base64 public key from SendGrid)
//
// Install dependency (on server/project root):
//   npm install tweetnacl
//
// Notes:
// - Place this file exactly at pages/api/webhooks/sendgrid-events.js
// - This file imports supabaseAdmin from "../../../utils/supabase-admin". If your utils path differs, adjust the import path accordingly.
// - Do NOT expose SUPABASE_SERVICE_ROLE_KEY to the browser. This file is server-side only.
//
// Behavior:
// - Verifies incoming request signature. If invalid, rejects with 401.
// - Parses the JSON array of events and processes each.
// - Writes an audit row to sendgrid_events for every event processed (so you can reconcile).
// - Attempts to match the event to an email_sends row using several strategies and updates that row when matched.
//
// Full-file replacement follows:
import { buffer } from "micro";
import nacl from "tweetnacl";
import { supabaseAdmin } from "../../../utils/supabase-admin"; // Ensure this path is correct for your repo

export const config = {
  api: {
    bodyParser: false, // required to read raw body for signature verification
  },
};

const SENDGRID_SIGNING_KEY = process.env.SENDGRID_SIGNING_KEY || null;

if (!SENDGRID_SIGNING_KEY) {
  // Warn during server startup if not set (still allow deploy so you can add key)
  // Signature verification will reject until this is provided.
  // eslint-disable-next-line no-console
  console.warn(
    "[sendgrid-webhook] Warning: SENDGRID_SIGNING_KEY not set — webhook signature verification will fail until provided."
  );
}

/**
 * Verify SendGrid webhook signature using Ed25519
 * SendGrid headers (common names):
 *  - x-twilio-email-event-webhook-signature  (base64 signature)
 *  - x-twilio-email-event-webhook-timestamp  (string timestamp)
 *
 * Message to verify = timestamp + rawBody (concatenated bytes)
 */
function verifySendGridSignature(rawBodyBuffer, timestampHeader, signatureHeaderBase64) {
  try {
    if (!signatureHeaderBase64 || !timestampHeader) return false;
    const signature = Buffer.from(signatureHeaderBase64, "base64");
    const publicKey = Buffer.from(SENDGRID_SIGNING_KEY, "base64");
    const tsBuf = Buffer.from(String(timestampHeader), "utf8");
    const msg = Buffer.concat([tsBuf, rawBodyBuffer]);
    const ok = nacl.sign.detached.verify(
      new Uint8Array(msg),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
    return Boolean(ok);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Signature verification error:", err && err.message ? err.message : err);
    return false;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Read raw body for signature verification
    const raw = await buffer(req); // Buffer
    // Try common SendGrid header names (some libs/providers differ)
    const sigHeader =
      req.headers["x-twilio-email-event-webhook-signature"] ||
      req.headers["x-twilio-email-event-webhook-signature-1"] ||
      req.headers["x-sendgrid-signature"] ||
      req.headers["x-sendgrid-signature-1"];
    const tsHeader =
      req.headers["x-twilio-email-event-webhook-timestamp"] ||
      req.headers["x-sendgrid-timestamp"] ||
      req.headers["x-sendgrid-timestamp-1"];

    if (!SENDGRID_SIGNING_KEY) {
      // Not configured - reject to avoid processing unsigned webhooks in production
      // eslint-disable-next-line no-console
      console.error("SENDGRID_SIGNING_KEY not configured - rejecting webhook.");
      return res.status(401).json({ ok: false, error: "Webhook signature verification not configured" });
    }

    const verified = verifySendGridSignature(raw, tsHeader, sigHeader);
    if (!verified) {
      // eslint-disable-next-line no-console
      console.warn("SendGrid webhook signature verification failed.");
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    // Parse JSON body (SendGrid posts an array of events)
    const bodyText = raw.toString("utf8");
    let events;
    try {
      events = JSON.parse(bodyText);
      if (!Array.isArray(events)) events = [events];
    } catch (parseErr) {
      // eslint-disable-next-line no-console
      console.error("Failed to parse JSON body:", parseErr);
      return res.status(400).json({ ok: false, error: "Invalid JSON" });
    }

    let processedCount = 0;

    for (const ev of events) {
      try {
        // Normalize fields
        const evType = String(ev?.event || "").toLowerCase();
        const evTimestamp = ev?.timestamp ? new Date(Number(ev.timestamp) * 1000).toISOString() : new Date().toISOString();
        const sgEventId = ev?.sg_event_id || ev?.sgEventId || ev?.sg_eventId || null;
        const rawSgMsgId = ev?.sg_message_id || ev?.sgMessageId || ev?.sg_messageId || null;
        // SendGrid sometimes appends ".filter" or wraps id in <...>
        const sgMsgId = rawSgMsgId ? String(rawSgMsgId).split(".")[0].replace(/[<>]/g, "") : null;
        const email = ev?.email || ev?.recipient || null;
        const customArgs = ev?.custom_args || ev?.customArgs || ev?.customArguments || {};

        // Deduplicate by sg_event_id when present
        if (sgEventId) {
          const { data: existingEvt } = await supabaseAdmin
            .from("sendgrid_events")
            .select("id")
            .eq("sg_event_id", String(sgEventId))
            .limit(1);
          if (existingEvt && existingEvt.length) {
            // already processed this event
            continue;
          }
        }

        // Insert audit row for every event
        const auditRow = {
          created_at: evTimestamp,
          event: evType || null,
          email: email || null,
          timestamp: ev?.timestamp || null,
          sg_message_id: sgMsgId || rawSgMsgId || null,
          sg_event_id: sgEventId || null,
          payload: ev || {},
        };
        await supabaseAdmin.from("sendgrid_events").insert(auditRow);

        // Find matching send record (best-effort):
        // 1) custom_args.gr8_send_row_id
        // 2) email_sends.sendgrid_message_id
        // 3) latest email_sends for that email created on-or-before event time
        let matchedSend = null;

        // (1) custom arg match
        const rowId = customArgs?.gr8_send_row_id ? String(customArgs.gr8_send_row_id) : null;
        if (rowId) {
          const { data: byRow } = await supabaseAdmin
            .from("email_sends")
            .select("id, open_count, click_count, email, broadcast_id")
            .eq("id", rowId)
            .limit(1)
            .maybeSingle();
          if (byRow) matchedSend = byRow;
        }

        // (2) sendgrid_message_id match
        if (!matchedSend && sgMsgId) {
          const { data: bySg } = await supabaseAdmin
            .from("email_sends")
            .select("id, open_count, click_count, email, broadcast_id")
            .eq("sendgrid_message_id", sgMsgId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (bySg) matchedSend = bySg;
        }

        // (3) fallback: most recent send for this email before event time
        if (!matchedSend && email) {
          const { data: recent } = await supabaseAdmin
            .from("email_sends")
            .select("id, open_count, click_count, email, broadcast_id, created_at")
            .eq("email", email)
            .lte("created_at", evTimestamp)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (recent) matchedSend = recent;
        }

        // Apply event updates (safe read-then-update increment for counts)
        if (matchedSend && matchedSend.id) {
          const updates = {};
          const nowIso = new Date().toISOString();

          if (evType === "open") {
            updates.open_count = Number(matchedSend.open_count || 0) + 1;
            updates.last_event = "open";
            updates.last_event_at = nowIso;
            updates.status = "opened";
          } else if (evType === "click") {
            updates.click_count = Number(matchedSend.click_count || 0) + 1;
            updates.last_event = "click";
            updates.last_event_at = nowIso;
            updates.status = "clicked";
          } else if (evType === "delivered" || evType === "processed") {
            updates.delivered_at = nowIso;
            updates.last_event = "delivered";
            updates.last_event_at = nowIso;
            updates.status = "delivered";
          } else if (evType === "bounce" || evType === "dropped") {
            updates.bounced_at = nowIso;
            updates.last_event = evType;
            updates.last_event_at = nowIso;
            updates.status = "bounced";
          } else if (evType === "unsubscribe" || evType === "group_unsubscribe") {
            updates.unsubscribed = true;
            updates.unsubscribed_at = nowIso;
            updates.last_event = "unsubscribe";
            updates.last_event_at = nowIso;
            updates.status = "unsubscribe";
          }

          // Persist sendgrid_message_id when available (helps future matching)
          if (sgMsgId) updates.sendgrid_message_id = sgMsgId;

          if (Object.keys(updates).length) {
            await supabaseAdmin.from("email_sends").update(updates).eq("id", matchedSend.id);
            processedCount += 1;
          }
        } else {
          // No match found; audit row exists so you can reconcile manually.
          // Optionally implement matching by broadcast id or other custom args here.
        }
      } catch (evErr) {
        // Log and continue with other events
        // eslint-disable-next-line no-console
        console.error("Error processing event:", evErr && evErr.message ? evErr.message : evErr);
      }
    }

    return res.status(200).json({ ok: true, processed: processedCount });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Webhook handler error:", err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}