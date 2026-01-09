// /pages/api/twilio/recording.js

export const config = {
  api: {
    responseLimit: false,
  },
};

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

// SAFE recording proxy
// - If no sid/url → return 204 (no error, no banner)
// - If exists → stream mp3
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  const sid = String(req.query?.sid || "").trim();
  const url = String(req.query?.url || "").trim();

  // 🔒 IMPORTANT: silently ignore empty calls
  if (!sid && !url) {
    return res.status(204).end();
  }

  try {
    const accountSid = pickEnv("TWILIO_ACCOUNT_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN");

    must(accountSid, "TWILIO_ACCOUNT_SID");
    must(authToken, "TWILIO_AUTH_TOKEN");

    let base;
    if (sid) {
      base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}`;
    } else {
      base = url.replace(/\.json(\?.*)?$/i, "");
    }

    const mediaUrl = `${base}.mp3`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const r = await fetch(mediaUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!r.ok) {
      return res.status(204).end();
    }

    res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200).send(buf);
  } catch {
    // NEVER surface recording errors to UI
    return res.status(204).end();
  }
}
