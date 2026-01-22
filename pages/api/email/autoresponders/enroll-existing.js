// /pages/api/email/autoresponders/enroll-existing.js
// FULL REPLACEMENT
//
// ✅ Enrolls EVERY email_list_members row for list_id into email_autoresponder_queue
// ✅ De-dupes by (autoresponder_id, to_email) using your unique index
// ✅ Multi-tenant safe: verifies list belongs to logged-in user via lead_lists
// ✅ Auth: Bearer token (Supabase session)
//
// Body:
//  { autoresponder_id, list_id }
//
// Returns:
//  { ok:true, added, skipped }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE;

function s(v) {
  return String(v ?? "").trim();
}

function isEmail(v) {
  const x = s(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

async function getUserFromBearer(req) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = s(m?.[1]);
  if (!token) return null;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await anon.auth.getUser(token);
  if (error) return null;
  return data?.user || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res
      .status(500)
      .json({ ok: false, error: "Missing Supabase env keys" });
  }

  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const body = req.body || {};
  const autoresponder_id = s(body.autoresponder_id);
  const list_id = s(body.list_id);

  if (!autoresponder_id) {
    return res.status(400).json({ ok: false, error: "Missing autoresponder_id" });
  }
  if (!list_id) {
    return res.status(400).json({ ok: false, error: "Missing list_id" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 1) Verify autoresponder belongs to user + get subject/template_path
  const { data: ar, error: arErr } = await admin
    .from("email_automations")
    .select("id,user_id,subject,template_path,is_active")
    .eq("id", autoresponder_id)
    .single();

  if (arErr || !ar) {
    return res.status(404).json({ ok: false, error: "Autoresponder not found" });
  }
  if (String(ar.user_id) !== String(user.id)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  // Optional: only enroll if active
  if (ar.is_active === false) {
    return res.status(200).json({
      ok: true,
      added: 0,
      skipped: 0,
      note: "Autoresponder is not active.",
    });
  }

  // 2) Verify list belongs to user (multi-tenant safety)
  const { data: listRow, error: listErr } = await admin
    .from("lead_lists")
    .select("id,user_id")
    .eq("id", list_id)
    .single();

  if (listErr || !listRow) {
    return res.status(404).json({ ok: false, error: "List not found" });
  }
  if (String(listRow.user_id) !== String(user.id)) {
    return res.status(403).json({ ok: false, error: "Forbidden (list)" });
  }

  // 3) Load members from email_list_members (this has email + name)
  const { data: members, error: memErr } = await admin
    .from("email_list_members")
    .select("email,name")
    .eq("list_id", list_id);

  if (memErr) {
    return res.status(500).json({ ok: false, error: memErr.message });
  }

  const cleaned = (Array.isArray(members) ? members : [])
    .map((m) => ({
      to_email: s(m?.email).toLowerCase(),
      to_name: s(m?.name) || null,
    }))
    .filter((m) => isEmail(m.to_email));

  if (!cleaned.length) {
    return res.status(200).json({
      ok: true,
      added: 0,
      skipped: 0,
      note: "No eligible emails in email_list_members.",
    });
  }

  // 4) Pull existing queue emails to de-dupe
  const { data: existing, error: exErr } = await admin
    .from("email_autoresponder_queue")
    .select("to_email")
    .eq("autoresponder_id", autoresponder_id);

  if (exErr) {
    return res.status(500).json({ ok: false, error: exErr.message });
  }

  const existingEmails = new Set(
    (Array.isArray(existing) ? existing : [])
      .map((r) => s(r?.to_email).toLowerCase())
      .filter(Boolean)
  );

  const now = new Date().toISOString();

  const toInsert = [];
  let skipped = 0;

  for (const m of cleaned) {
    if (existingEmails.has(m.to_email)) {
      skipped++;
      continue;
    }

    toInsert.push({
      user_id: user.id,
      autoresponder_id,
      list_id,

      lead_id: null, // using email_list_members, not CRM leads
      to_email: m.to_email,
      to_name: m.to_name,

      subject: s(ar.subject),
      template_path: s(ar.template_path),

      scheduled_at: now,
      status: "queued",

      attempts: 0,
      last_error: null,
      provider_message_id: null,
      sent_at: null,
      created_at: now,
    });
  }

  if (!toInsert.length) {
    return res.status(200).json({
      ok: true,
      added: 0,
      skipped,
      note: "All members already queued.",
    });
  }

  // 5) Insert
  const { error: insErr } = await admin
    .from("email_autoresponder_queue")
    .insert(toInsert);

  if (insErr) {
    // If your unique index exists (autoresponder_id,to_email) and
    // something races, you can get duplicate errors.
    return res.status(500).json({ ok: false, error: insErr.message });
  }

  return res.status(200).json({ ok: true, added: toInsert.length, skipped });
}
