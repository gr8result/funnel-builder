// /pages/api/twilio/recording-callback.js
// FULL REPLACEMENT
//
// ✅ Attaches recording to EXISTING crm_calls row
// ✅ Preserves outbound direction
// ✅ BACKFILLS lead_id via phone lookup if missing
// ✅ AUTO-APPENDS recording into leads.notes
// ✅ No fake inbound rows
// ✅ Idempotent / retry-safe

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function normPhone(v) {
  return s(v).replace(/[^\d+]/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const body = req.body || {};

    const callSid = s(body.CallSid);
    const recordingSid = s(body.RecordingSid);
    const recordingDuration = Number(body.RecordingDuration || 0);

    if (!callSid || !recordingSid) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const recordingUrl = `/api/twilio/recording?sid=${encodeURIComponent(
      recordingSid
    )}`;

    // 1️⃣ Load existing call row
    const { data: callRow } = await supabase
      .from("crm_calls")
      .select(
        "id, lead_id, user_id, from_number, to_number"
      )
      .eq("twilio_sid", callSid)
      .maybeSingle();

    let leadId = callRow?.lead_id || null;
    let userId = callRow?.user_id || null;

    // 2️⃣ Backfill lead_id via phone lookup IF missing
    if (!leadId) {
      const phone =
        normPhone(callRow?.from_number) ||
        normPhone(body.From) ||
        normPhone(body.Caller);

      if (phone) {
        const { data: lead } = await supabase
          .from("leads")
          .select("id,user_id,notes")
          .or(
            `phone.eq.${phone},phone.eq.${phone.replace(/^61/, "0")}`
          )
          .limit(1)
          .maybeSingle();

        if (lead) {
          leadId = lead.id;
          userId = lead.user_id || null;
        }
      }
    }

    // 3️⃣ Update crm_calls (NO new rows)
    await supabase
      .from("crm_calls")
      .update({
        recording_url: recordingUrl,
        recording_duration: Number.isFinite(recordingDuration)
          ? recordingDuration
          : null,
        has_recording: true,
        direction: "outbound",
        unread: true,
        lead_id: leadId,
        user_id: userId,
      })
      .eq("twilio_sid", callSid);

    // 4️⃣ Append into leads.notes (AUTO)
    if (leadId) {
      const stamp = new Date().toLocaleString();
      const line =
        `[${stamp}] Call recorded (${recordingDuration}s)\n` +
        `Recording: ${recordingUrl}\n\n`;

      await supabase.rpc("append_lead_note_safe", {
        p_lead_id: leadId,
        p_text: line,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[recording-callback]", e);
    return res.status(200).json({ ok: false });
  }
}
v