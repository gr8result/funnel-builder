// /pages/api/twilio/list-call-recordings.js
// FULL REPLACEMENT
//
// Returns recent Twilio recordings, optionally filtered by phone.
// Query:
//   ?phone=+614...   (optional, best effort filter)
//   ?limit=50        (optional)
//
// ENV required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN

import twilio from "twilio";

function s(v) {
  return String(v ?? "").trim();
}

function normalizePhone(v) {
  const x = s(v).replace(/[^\d+]/g, "");
  if (!x) return "";
  // If AU local 04... -> +61...
  if (!x.startsWith("+") && x.startsWith("0") && x.length >= 9) return "+61" + x.slice(1);
  if (!x.startsWith("+") && x.startsWith("61")) return "+" + x;
  return x;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const ACCOUNT_SID = s(process.env.TWILIO_ACCOUNT_SID);
    const AUTH_TOKEN = s(process.env.TWILIO_AUTH_TOKEN);
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing TWILIO env vars" });
    }

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

    const phoneQ = normalizePhone(req.query.phone);

    // Recordings list (no direct phone filter available reliably),
    // so we fetch recent recordings then fetch their call details to match phone.
    const recs = await client.recordings.list({ limit });

    // Fetch call details for each recording (so we can return from/to and filter by phone)
    const out = [];
    for (const r of recs) {
      let call = null;
      try {
        if (r.callSid) call = await client.calls(r.callSid).fetch();
      } catch {
        call = null;
      }

      const from = call?.from || "";
      const to = call?.to || "";

      // Best-effort phone filter
      if (phoneQ) {
        const nf = normalizePhone(from);
        const nt = normalizePhone(to);
        if (phoneQ !== nf && phoneQ !== nt) continue;
      }

      out.push({
        sid: r.sid, // Recording SID (RE...)
        recordingSid: r.sid,
        callSid: r.callSid || "",
        dateCreated: r.dateCreated || null,
        duration: r.duration != null ? Number(r.duration) : null,
        from,
        to,
      });
    }

    return res.status(200).json({ ok: true, recordings: out });
  } catch (e) {
    console.error("list-call-recordings error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
