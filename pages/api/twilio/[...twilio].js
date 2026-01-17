// /pages/api/twilio/[...twilio].js
// NEW FILE (or FULL REPLACEMENT if it exists)
//
// ✅ Ensures /api/twilio/list-calls and /api/twilio/recording always work
// ✅ Stops random legacy handlers returning “Url parameter is required.”

import twilio from "twilio";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function toInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function isHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const slug = req.query?.twilio;
  const parts = Array.isArray(slug) ? slug : [String(slug || "").trim()].filter(Boolean);
  const route = String(parts[0] || "").toLowerCase();

  // ---- LIST CALLS ----
  if (route === "list-calls") {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const accountSid = pickEnv("TWILIO_ACCOUNT_SID", "TWILIO_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN", "TWILIO_TOKEN");
    if (!accountSid || !authToken) {
      return res.status(500).json({
        ok: false,
        error: "Twilio env missing: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN",
      });
    }

    try {
      const client = twilio(accountSid, authToken);
      const limit = toInt(req.query?.limit, 50);
      const list = await client.calls.list({ limit });

      const calls = (list || []).map((c) => ({
        sid: c.sid,
        startTime: c.startTime || c.dateCreated || null,
        direction: c.direction || "-",
        from: c.from || "-",
        to: c.to || "-",
        duration: Number(c.duration) || 0,
        status: c.status || null,
        recordingSid: null,
        recordingUrl: null,
      }));

      return res.status(200).json({ ok: true, calls });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "Failed to list calls." });
    }
  }

  // ---- RECORDING STREAM ----
  if (route === "recording") {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const accountSid = pickEnv("TWILIO_ACCOUNT_SID", "TWILIO_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN", "TWILIO_TOKEN");
    if (!accountSid || !authToken) {
      return res.status(500).json({
        ok: false,
        error: "Twilio env missing: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN",
      });
    }

    const sid = String(req.query?.sid || "").trim();
    let urlParam = String(req.query?.url || "").trim();

    if (!sid && !urlParam) {
      return res.status(400).json({ ok: false, error: "Recording requires sid or url." });
    }

    try {
      let mediaUrl = "";

      if (sid) {
        mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${encodeURIComponent(
          sid
        )}.mp3`;
      } else {
        if (!isHttpUrl(urlParam)) {
          return res.status(400).json({ ok: false, error: "Invalid recording url." });
        }
        if (!urlParam.endsWith(".mp3") && !urlParam.endsWith(".wav")) {
          urlParam = urlParam.replace(/\/Recordings\/([A-Za-z0-9]+)(\?.*)?$/i, "/Recordings/$1.mp3$2");
        }
        mediaUrl = urlParam;
      }

      const fetchRes = await fetch(mediaUrl, {
        headers: {
          Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
      });

      if (!fetchRes.ok) {
        const txt = await fetchRes.text().catch(() => "");
        return res.status(502).json({
          ok: false,
          error: `Failed to fetch recording (${fetchRes.status}). ${txt || ""}`.trim(),
        });
      }

      res.setHeader("Content-Type", fetchRes.headers.get("content-type") || "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");

      const buf = Buffer.from(await fetchRes.arrayBuffer());
      return res.status(200).send(buf);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "Failed to stream recording." });
    }
  }

  // ---- UNKNOWN ----
  return res.status(404).json({ ok: false, error: "Unknown Twilio endpoint." });
}
