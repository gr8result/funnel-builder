// /pages/api/twilio/list-calls.js
// FULL REPLACEMENT — supports include_recordings=1 + optional phone filter
//
// GET /api/twilio/list-calls?limit=50&include_recordings=1&phone=+614...
//
// ✅ Lists recent calls from Twilio
// ✅ If include_recordings=1, attaches recording SID + secure proxy URL (/api/twilio/recording?sid=RE...)
// ✅ If phone provided, filters by phone (handles +61 / 61 / 0 variants)
//
// Required env:
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN

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

function s(v) {
  return String(v ?? "").trim();
}

function digitsOnly(v) {
  return s(v).replace(/[^\d]/g, "");
}

function normalisePhoneVariants(raw) {
  const out = new Set();
  const rawStr = s(raw);
  if (!rawStr) return [];

  const d = digitsOnly(rawStr);

  // already + format?
  const plus = rawStr.replace(/[^\d+]/g, "");
  if (plus.startsWith("+")) {
    out.add(plus);
    out.add(plus.replace("+", ""));
  }

  if (d) {
    out.add(d);

    // AU assumptions
    if (d.startsWith("0")) {
      // 04xxxxxxxx -> +614xxxxxxxx
      out.add("61" + d.slice(1));
      out.add("+61" + d.slice(1));
    } else if (d.startsWith("61")) {
      out.add("+" + d);
      out.add(d);
      // also allow local-ish 0 form if mobile
      if (d.startsWith("614") && d.length >= 11) {
        out.add("0" + d.slice(2));
      }
    } else if (d.startsWith("4") && d.length === 9) {
      // 4xxxxxxxx -> +614xxxxxxxx
      out.add("61" + d);
      out.add("+61" + d);
      out.add("0" + d);
    } else {
      // fallback: try +61 + digits (last resort)
      out.add("+61" + d);
      out.add("61" + d);
    }
  }

  return Array.from(out).filter(Boolean);
}

export default async function handler(req, res) {
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

  const includeRecordings =
    s(req.query?.include_recordings) === "1" || s(req.query?.include_recordings).toLowerCase() === "true";

  const limit = toInt(req.query?.limit, 50);
  const phone = s(req.query?.phone);

  try {
    const client = twilio(accountSid, authToken);

    // Twilio list() doesn't support "OR phone variants" directly.
    // We'll pull a larger set then filter in code.
    const fetchLimit = Math.min(Math.max(limit * (phone ? 6 : 1), limit), 200);
    const list = await client.calls.list({ limit: fetchLimit });

    const variants = phone ? normalisePhoneVariants(phone) : [];
    const matchPhone = (num) => {
      const n = s(num);
      if (!variants.length) return true;
      if (!n) return false;

      const nPlus = n.replace(/[^\d+]/g, "");
      const nDigits = digitsOnly(nPlus);

      return variants.some((v) => {
        const vStr = s(v);
        const vPlus = vStr.replace(/[^\d+]/g, "");
        const vDigits = digitsOnly(vPlus);
        return nPlus === vPlus || nDigits === vDigits;
      });
    };

    let calls = (list || [])
      .filter((c) => {
        if (!variants.length) return true;
        return matchPhone(c.from) || matchPhone(c.to);
      })
      .slice(0, limit)
      .map((c) => ({
        sid: c.sid,
        startTime: c.startTime || c.dateCreated || null,
        direction: c.direction || "-",
        from: c.from || "-",
        to: c.to || "-",
        duration: Number(c.duration) || 0,
        status: c.status || null,
        recordingSid: null,
        recordingUrl: null,
        recordingDuration: null,
      }));

    if (includeRecordings) {
      // For each call, try to find a recording. (Usually 0 or 1)
      // Note: Twilio recording list() can be slow; keep it bounded.
      const withRec = [];

      for (const c of calls) {
        const row = { ...c };
        try {
          const recs = await client.recordings.list({ callSid: c.sid, limit: 1 });
          const rec = recs && recs[0] ? recs[0] : null;
          if (rec?.sid) {
            row.recordingSid = rec.sid;
            row.recordingUrl = `/api/twilio/recording?sid=${encodeURIComponent(rec.sid)}`;
            row.recordingDuration = Number(rec.duration) || null;
          }
        } catch {
          // ignore per-call recording fetch errors
        }
        withRec.push(row);
      }

      calls = withRec;
    }

    return res.status(200).json({ ok: true, calls });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to list calls." });
  }
}
