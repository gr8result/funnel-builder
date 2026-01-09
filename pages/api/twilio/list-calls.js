// /pages/api/twilio/list-calls.js
import twilio from "twilio";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function must(v, name) {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });

  try {
    const accountSid = pickEnv("TWILIO_ACCOUNT_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN");

    must(accountSid, "TWILIO_ACCOUNT_SID");
    must(authToken, "TWILIO_AUTH_TOKEN");

    const client = twilio(accountSid, authToken);

    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));

    // Recent calls
    const calls = await client.calls.list({ limit });

    // Recent recordings (map by callSid)
    const recs = await client.recordings.list({ limit });
    const recByCallSid = new Map();
    for (const r of recs) {
      if (!r?.callSid) continue;
      if (!recByCallSid.has(r.callSid)) recByCallSid.set(r.callSid, r);
    }

    const out = (calls || []).map((c) => {
      const r = recByCallSid.get(c.sid);
      // recordingUrl here is the Twilio API recording resource (not the direct .mp3)
      // We proxy it via /api/twilio/recording
      const recordingSid = r?.sid || null;
      const recordingUrl = r?.uri ? `https://api.twilio.com${r.uri}` : null;

      return {
        sid: c.sid,
        start_time: c.startTime ? c.startTime.toISOString?.() || c.startTime : c.startTime || null,
        direction: c.direction || null,
        from: c.from || null,
        to: c.to || null,
        duration: c.duration ? Number(c.duration) || 0 : 0,
        status: c.status || null,
        recording_sid: recordingSid,
        recording_url: recordingUrl,
      };
    });

    return res.status(200).json({ ok: true, calls: out });
  } catch (e) {
    const msg = e?.message || "Failed to list calls";
    return res.status(500).json({ ok: false, error: msg });
  }
}
