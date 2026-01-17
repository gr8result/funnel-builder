// /pages/api/twilio/list-call-recordings.js
// NEW FILE — FULL CONTENT
//
// ✅ Lists calls + recordings directly from Twilio for a given phone number
// ✅ Returns recordings sorted newest-first
//
// Query:
//   /api/twilio/list-call-recordings?phone=+61412345678&limit=50
//
// ENV required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//
// Response:
//   { ok: true, recordings: [{ sid, callSid, dateCreated, duration, direction, from, to }] }

function s(v) {
  return String(v ?? "").trim();
}

function toInt(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.floor(n);
}

function basicAuthHeader(accountSid, authToken) {
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

async function twilioGetJson(url, accountSid, authToken) {
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(accountSid, authToken),
      Accept: "application/json",
    },
  });

  const text = await r.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!r.ok) {
    const msg =
      (json && (json.message || json.error)) ||
      text ||
      `Twilio request failed (${r.status})`;
    const err = new Error(msg);
    err.status = r.status;
    err.detail = json || text;
    throw err;
  }

  return json || {};
}

function normalizePhoneLoose(raw) {
  // keep + and digits only; Twilio expects E.164-ish
  return s(raw).replace(/[^\d+]/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const accountSid = s(process.env.TWILIO_ACCOUNT_SID);
    const authToken = s(process.env.TWILIO_AUTH_TOKEN);

    if (!accountSid || !authToken) {
      return res.status(500).json({
        ok: false,
        error: "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN",
      });
    }

    const phoneRaw = s(req.query?.phone);
    const phone = normalizePhoneLoose(phoneRaw);
    const limit = Math.min(200, toInt(req.query?.limit, 50));

    if (!phone) {
      return res.status(400).json({ ok: false, error: "Missing phone" });
    }

    const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      accountSid
    )}`;

    // Twilio only filters by To or From separately
    const callsToUrl = `${base}/Calls.json?To=${encodeURIComponent(
      phone
    )}&PageSize=${encodeURIComponent(Math.min(100, limit))}`;

    const callsFromUrl = `${base}/Calls.json?From=${encodeURIComponent(
      phone
    )}&PageSize=${encodeURIComponent(Math.min(100, limit))}`;

    const [callsTo, callsFrom] = await Promise.all([
      twilioGetJson(callsToUrl, accountSid, authToken).catch(() => ({ calls: [] })),
      twilioGetJson(callsFromUrl, accountSid, authToken).catch(() => ({ calls: [] })),
    ]);

    const mapBySid = new Map();
    for (const c of [...(callsTo.calls || []), ...(callsFrom.calls || [])]) {
      if (c && c.sid) mapBySid.set(c.sid, c);
    }

    const calls = Array.from(mapBySid.values());

    calls.sort((a, b) => {
      const ta = Date.parse(a.start_time || a.date_created || "") || 0;
      const tb = Date.parse(b.start_time || b.date_created || "") || 0;
      return tb - ta;
    });

    const out = [];

    for (const call of calls.slice(0, limit)) {
      const callSid = s(call.sid);
      if (!callSid) continue;

      const recUrl = `${base}/Calls/${encodeURIComponent(
        callSid
      )}/Recordings.json?PageSize=50`;

      let recJson = null;
      try {
        recJson = await twilioGetJson(recUrl, accountSid, authToken);
      } catch {
        recJson = { recordings: [] };
      }

      const recs = Array.isArray(recJson?.recordings) ? recJson.recordings : [];
      for (const r of recs) {
        const sid = s(r?.sid);
        if (!sid) continue;

        out.push({
          sid,
          callSid,
          dateCreated: r?.date_created || call?.start_time || call?.date_created || null,
          duration:
            r?.duration != null
              ? Number(r.duration)
              : call?.duration != null
              ? Number(call.duration)
              : null,
          direction: call?.direction || null,
          from: call?.from || null,
          to: call?.to || null,
        });
      }
    }

    out.sort((a, b) => {
      const ta = Date.parse(a.dateCreated || "") || 0;
      const tb = Date.parse(b.dateCreated || "") || 0;
      return tb - ta;
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, phone, recordings: out.slice(0, limit) });
  } catch (e) {
    console.error("[list-call-recordings] error:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to list call recordings",
    });
  }
}
