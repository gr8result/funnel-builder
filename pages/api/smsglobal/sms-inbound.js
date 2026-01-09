// /pages/api/smsglobal/inbound.js
// FULL FILE — SMSGlobal Incoming Messages webhook (MO)
//
// SMSGlobal will send: from, to, msg, date, msgid (GET or POST) and your endpoint must echo "OK" :contentReference[oaicite:3]{index=3}
//
// This handler:
// ✅ identifies tenant by inbound number (to) using telephony_numbers.smsglobal_number
// ✅ finds lead by phone/mobile
// ✅ processes STOP/UNSUBSCRIBE/etc => flags lead as opted out
// ✅ logs inbound into sms_messages (best-effort)
// ✅ ALWAYS responds "OK" so SMSGlobal stops retrying

import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: true },
};

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function s(v) {
  return String(v ?? "").trim();
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env.");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function digitsOnly(v) {
  return s(v).replace(/[^\d]/g, "");
}

function normalizeAuToE164Digits(v) {
  // returns digits only (e.g. 61417xxxxxx)
  let x = s(v).replace(/[^\d+]/g, "");
  if (!x) return "";
  if (x.startsWith("+")) x = x.slice(1);
  if (x.startsWith("0") && x.length >= 9) x = "61" + x.slice(1);
  return digitsOnly(x);
}

function isStop(msg) {
  const t = s(msg).toUpperCase();
  return ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(t);
}

async function findTenantByInboundNumber(sb, toDigits) {
  // Adjust this table/column to your real schema.
  // Expected: telephony_numbers(user_id uuid, smsglobal_number text)
  const { data, error } = await sb
    .from("telephony_numbers")
    .select("user_id,smsglobal_number")
    .eq("smsglobal_number", toDigits)
    .maybeSingle();

  if (error) return null;
  return data?.user_id || null;
}

async function findLeadByPhone(sb, user_id, fromDigits) {
  // Try common phone columns
  let q = sb
    .from("leads")
    .select("id,user_id,phone,mobile,opted_out,sms_opt_out")
    .or(`phone.eq.${fromDigits},mobile.eq.${fromDigits}`)
    .limit(1);

  if (user_id) q = q.eq("user_id", user_id);

  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return data || null;
}

export default async function handler(req, res) {
  try {
    const sb = admin();

    const fromRaw = req.method === "GET" ? req.query?.from : req.body?.from;
    const toRaw = req.method === "GET" ? req.query?.to : req.body?.to;
    const msgRaw = req.method === "GET" ? req.query?.msg : req.body?.msg;
    const msgid = req.method === "GET" ? req.query?.msgid : req.body?.msgid;

    const from = normalizeAuToE164Digits(fromRaw);
    const to = normalizeAuToE164Digits(toRaw);
    const msg = s(msgRaw);

    // Identify tenant by inbound number (to)
    const tenantUserId = to ? await findTenantByInboundNumber(sb, to) : null;

    // Find lead under that tenant (preferred)
    const lead = from ? await findLeadByPhone(sb, tenantUserId, from) : null;

    // Log inbound (best-effort)
    try {
      await sb.from("sms_messages").insert([
        {
          user_id: tenantUserId || lead?.user_id || null,
          lead_id: lead?.id || null,
          provider: "smsglobal",
          direction: "inbound",
          provider_id: s(msgid) || null,
          to,
          from,
          body: msg,
          received_at: new Date().toISOString(),
          status: "received",
        },
      ]);
    } catch {}

    // STOP handling
    if (lead && msg && isStop(msg)) {
      try {
        await sb
          .from("leads")
          .update({ sms_opt_out: true, opted_out: true })
          .eq("id", lead.id);
      } catch {}
    }

    // IMPORTANT: SMSGlobal requires echo "OK" :contentReference[oaicite:4]{index=4}
    res.status(200).send("OK");
  } catch (e) {
    // still return OK to stop retries
    res.status(200).send("OK");
  }
}
