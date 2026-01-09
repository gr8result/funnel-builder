// /pages/api/telephony/make-call.js
import twilio from "twilio";

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

// Makes calls work EVEN IF TWILIO_AGENT_PHONE IS NOT SET
// - If agent phone exists → bridge call (agent first, then customer)
// - If NOT → direct outbound call to customer
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const accountSid = pickEnv("TWILIO_ACCOUNT_SID");
    const authToken = pickEnv("TWILIO_AUTH_TOKEN");
    const fromNumber = pickEnv(
      "TWILIO_FROM_NUMBER",
      "TWILIO_CALLER_ID",
      "TWILIO_PHONE_NUMBER"
    );

    const agentPhone = pickEnv(
      "TWILIO_AGENT_PHONE",
      "TWILIO_AGENT_NUMBER",
      "TWILIO_MY_PHONE"
    );

    const { to, record } = req.body || {};
    const toNumber = String(to || "").trim();

    must(accountSid, "TWILIO_ACCOUNT_SID");
    must(authToken, "TWILIO_AUTH_TOKEN");
    must(fromNumber, "TWILIO_FROM_NUMBER");
    if (!toNumber) return res.status(400).json({ ok: false, error: "Missing 'to' number" });

    const client = twilio(accountSid, authToken);

    // ===============================
    // CASE 1: AGENT PHONE EXISTS
    // ===============================
    if (agentPhone) {
      const vr = new twilio.twiml.VoiceResponse();

      const dial = vr.dial({
        callerId: fromNumber,
        record: record ? "record-from-answer-dual" : undefined,
        recordingStatusCallbackEvent: record ? "completed" : undefined,
      });

      dial.number({}, toNumber);

      const call = await client.calls.create({
        to: agentPhone,
        from: fromNumber,
        twiml: vr.toString(),
      });

      return res.status(200).json({
        ok: true,
        mode: "agent-bridge",
        sid: call.sid,
        status: call.status,
      });
    }

    // ===============================
    // CASE 2: NO AGENT PHONE → DIRECT CALL
    // ===============================
    const call = await client.calls.create({
      to: toNumber,
      from: fromNumber,
      record: !!record,
      recordingChannels: record ? "dual" : undefined,
    });

    return res.status(200).json({
      ok: true,
      mode: "direct",
      sid: call.sid,
      status: call.status,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Call failed",
    });
  }
}
