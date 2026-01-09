// /pages/api/twilio/voice-dial.js
// Outbound TwiML for browser calls
// Twilio hits this (via your TwiML App) when the browser starts a call.

import { parse as parseForm } from "querystring";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

// We parse raw body so Twilio x-www-form-urlencoded always works
export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  try {
    let params = {};

    if (req.method === "POST") {
      const rawBody = await readRawBody(req);
      params = parseForm(rawBody || "");
    } else {
      params = req.query || {};
    }

    const toNumber = (params.To || "").toString().trim();
    const callerId =
      process.env.TWILIO_CALLER_ID || process.env.TWILIO_NUMBER || "";

    const twiml = new VoiceResponse();

    if (!toNumber) {
      twiml.say("No destination number was provided.");
    } else if (!callerId) {
      twiml.say("Caller ID is not configured on the server.");
    } else {
      const dial = twiml.dial({ callerId });
      dial.number(toNumber);
    }

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (err) {
    console.error("[twilio/voice-dial] ERROR", err);
    const twiml = new VoiceResponse();
    twiml.say("An application error occurred.");
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  }
}
