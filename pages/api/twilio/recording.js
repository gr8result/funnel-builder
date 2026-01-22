// /pages/api/twilio/recording.js
// FULL REPLACEMENT
//
// Streams Twilio recording audio by Recording SID.
// Usage:
//   /api/twilio/recording?sid=RExxxx
//
// ENV required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN

function s(v) {
  return String(v ?? "").trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).send("Method not allowed");
    }

    const ACCOUNT_SID = s(process.env.TWILIO_ACCOUNT_SID);
    const AUTH_TOKEN = s(process.env.TWILIO_AUTH_TOKEN);
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      return res.status(500).send("Missing TWILIO env vars");
    }

    const sid = s(req.query.sid);
    if (!sid || !sid.startsWith("RE")) {
      return res.status(400).send("Missing/invalid sid");
    }

    // Twilio media endpoint (MP3)
    const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${encodeURIComponent(
      sid
    )}.mp3`;

    const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");

    const r = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(r.status).send(txt || "Failed to fetch recording");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=60");

    const arr = Buffer.from(await r.arrayBuffer());
    return res.status(200).send(arr);
  } catch (e) {
    console.error("recording proxy error:", e);
    return res.status(500).send("Server error");
  }
}
