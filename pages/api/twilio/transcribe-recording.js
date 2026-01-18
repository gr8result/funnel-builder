// /pages/api/twilio/transcribe-recording.js
// NEW FILE
//
// ✅ NO COST transcription using your local Whisper container
// ✅ Fetches audio from YOUR existing Twilio streaming endpoint:
//      /api/twilio/recording?sid=RE...
// ✅ Forwards it to Whisper service (default http://127.0.0.1:5055)
// ✅ Returns { ok:true, text:"..." }
//
// ENV (optional):
//   TRANSCRIBE_BASE_URL=http://127.0.0.1:5055

export const config = {
  api: {
    bodyParser: false, // we stream audio through
  },
};

function s(v) {
  return String(v ?? "").trim();
}

export default async function handler(req, res) {
  try {
    const sid = s(req.query?.sid);
    if (!sid) {
      return res.status(400).json({ ok: false, error: "Missing sid" });
    }

    // Your local Whisper container
    const base =
      s(process.env.TRANSCRIBE_BASE_URL) || "http://127.0.0.1:5055";

    // Fetch audio from your existing endpoint (same app)
    const proto = String(req.headers["x-forwarded-proto"] || "http")
      .split(",")[0]
      .trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0]
      .trim();
    const selfBase = `${proto}://${host}`;

    const audioUrl = `${selfBase}/api/twilio/recording?sid=${encodeURIComponent(
      sid
    )}`;

    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) {
      const t = await audioResp.text().catch(() => "");
      return res
        .status(500)
        .json({ ok: false, error: `Failed to fetch audio: ${audioResp.status}`, detail: t });
    }

    // Whisper server expects multipart upload
    const audioBuf = Buffer.from(await audioResp.arrayBuffer());

    const form = new FormData();
    form.append(
      "file",
      new Blob([audioBuf], { type: "audio/mpeg" }),
      `${sid}.mp3`
    );

    // Optional: you can pass model or language if your server supports it
    // form.append("language", "en");

    const whisperResp = await fetch(`${base}/transcribe`, {
      method: "POST",
      body: form,
    });

    const json = await whisperResp.json().catch(() => null);
    if (!whisperResp.ok || !json) {
      return res.status(500).json({
        ok: false,
        error: "Whisper transcription failed",
        detail: json || null,
      });
    }

    return res.status(200).json({
      ok: true,
      text: s(json.text || json.transcript || ""),
      raw: json,
    });
  } catch (e) {
    console.error("[/api/twilio/transcribe-recording] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
