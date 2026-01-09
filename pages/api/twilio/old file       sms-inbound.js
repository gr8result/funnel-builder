// /pages/api/twilio/sms-inbound.js
// Receives inbound SMS from Twilio, finds the lead by phone and
// appends a timestamped line into the lead.notes field.

import { createClient } from "@supabase/supabase-js";
import { Twilio } from "twilio";
import querystring from "querystring";

export const config = {
  api: {
    bodyParser: false, // Twilio sends x-www-form-urlencoded
  },
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

function getTimestamp() {
  return new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// simple AU normaliser: +61xxxxxxxxx <-> 0xxxxxxxxx
function normaliseNumber(raw) {
  if (!raw) return null;
  const num = raw.replace(/[^\d+]/g, "");
  if (num.startsWith("+61")) return "0" + num.slice(3);
  if (num.startsWith("0")) return num;
  return num;
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const rawBody = await readRawBody(req);
    const body = querystring.parse(rawBody);

    const from = body.From; // "+614…"
    const text = body.Body || "";

    if (!from || !text) {
      return res.status(200).send("<Response></Response>");
    }

    const normalised = normaliseNumber(from);

    // 1️⃣ find lead by phone
    let lead = null;
    if (normalised) {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .or(
          [
            `phone.eq.${normalised}`,
            `phone.eq.${from}`,
            `mobile.eq.${normalised}`,
            `mobile.eq.${from}`,
          ].join(",")
        )
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        lead = data;
      }
    }

    // 2️⃣ build note line
    const stamp = getTimestamp();
    const line = `[${stamp}] SMS from ${from}: ${text}`;

    if (lead) {
      const existingNotes = lead.notes || "";
      const newNotes = existingNotes
        ? `${existingNotes.trim()}\n\n${line}`
        : line;

      const { error: updateError } = await supabase
        .from("leads")
        .update({ notes: newNotes, updated_at: new Date() })
        .eq("id", lead.id);

      if (updateError) {
        console.error("Error updating lead notes for SMS:", updateError);
      }
    } else {
      console.warn("Inbound SMS – no matching lead for number:", from);
    }

    // 3️⃣ optional auto-reply (kept simple for now)
    const twiml = `<Response></Response>`;
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml);
  } catch (err) {
    console.error("sms-inbound error:", err);
    return res.status(500).send("<Response></Response>");
  }
}
