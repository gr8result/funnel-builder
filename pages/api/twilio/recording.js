// /pages/api/twilio/recording.js
// FULL REPLACEMENT
//
// ✅ Streams a Twilio Recording as audio/mpeg so <audio> works
// ✅ Fixes "blank player" (0:00 / 0:00) by returning actual MP3 bytes + correct headers
//
// Usage:
//   /api/twilio/recording?sid=RExxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// ENV required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN

function s(v) {
  return String(v ?? "").trim();
}

function basicAuthHeader(accountSid, authToken) {
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method not allowed");
  }

  try {
    const accountSid = s(process.env.TWILIO_ACCOUNT_SID);
    const authToken = s(process.env.TWILIO_AUTH_TOKEN);
    const sid = s(req.query?.sid);

    if (!accountSid || !authToken) {
      return res.status(500).end("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
    }
    if (!sid) {
      return res.status(400).end("Missing sid");
    }

    // Twilio recordings: fetch as MP3
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      accountSid
    )}/Recordings/${encodeURIComponent(sid)}.mp3`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(accountSid, authToken),
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      res.status(r.status);
      return res.end(txt || `Twilio recording fetch failed (${r.status})`);
    }

    // Important: set audio headers so the browser can load duration + seek
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    const len = r.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);

    // Support range requests if possible (better UX). If Twilio supports it, forward it.
    const acceptRanges = r.headers.get("accept-ranges");
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

    // Stream the bytes
    const arrayBuffer = await r.arrayBuffer();
    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (e) {
    console.error("[/api/twilio/recording] error:", e);
    return res.status(500).end(e?.message || "Recording proxy error");
  }
}
