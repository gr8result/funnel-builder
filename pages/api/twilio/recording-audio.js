// /pages/api/twilio/recording-audio.js
// FULL REPLACEMENT
//
// Streams Twilio recording audio from a RecordingUrl saved in DB.
// Usage:
//   /api/twilio/recording-audio?url=https://api.twilio.com/2010-04-01/Accounts/.../Recordings/RE....json
//
// ENV required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN

function s(v) {
  return String(v ?? "").trim();
}

function toMp3Url(u) {
  const url = s(u);
  if (!url) return "";
  // If it's the .json endpoint, swap to .mp3
  if (url.endsWith(".json")) return url.replace(/\.json$/i, ".mp3");
  // If it's already mp3/wav etc, keep it
  if (/\.(mp3|wav)(\?|$)/i.test(url)) return url;
  // If it's the resource without extension, append .mp3
  if (/\/Recordings\/RE[a-zA-Z0-9]+$/i.test(url)) return url + ".mp3";
  return url;
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

    const rawUrl = s(req.query.url);
    if (!rawUrl) return res.status(400).send("Missing url");

    const url = toMp3Url(rawUrl);
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
    console.error("recording-audio proxy error:", e);
    return res.status(500).send("Server error");
  }
}
