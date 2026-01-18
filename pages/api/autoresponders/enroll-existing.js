// /pages/api/email/autoresponders/enroll-existing.js
// FULL REPLACEMENT — Enroll existing list members into email_autoresponder_queue (correct schema)
//
// POST { autoresponder_id, list_id }
//
// ✅ Verifies Bearer token user
// ✅ Confirms autoresponder belongs to user and matches list_id
// ✅ Selects recipients from public.email_list_members for list_id
// ✅ Inserts rows into public.email_autoresponder_queue using autoresponder_id (NOT automation_id)
// ✅ Skips duplicates (best-effort) and reports added/skipped
//
// NOTE: This only enqueues. Your existing sender/worker should send queued rows.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function getBearerToken(req) {
  const h = req.headers.authorization || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function safeString(v) {
  return String(v ?? "").trim();
}

function computeScheduleIso(autoresponder) {
  // Keep it simple + predictable:
  // - delay_type "immediate" => now
  // - else if delay_days numeric => now + N days
  const now = new Date();
  const dd =
    Number(autoresponder?.delay_days ?? autoresponder?.delay_value ?? 0) || 0;

  const delayType = safeString(autoresponder?.delay_type || "").toLowerCase();
  if (delayType === "immediate" || dd <= 0) return now.toISOString();

  const d = new Date(now.getTime() + dd * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !u?.user) return res.status(401).json({ ok: false, error: "Invalid token" });
    const userId = u.user.id;

    const autoresponderId = safeString(req.body?.autoresponder_id);
    const listId = safeString(req.body?.list_id);
    if (!autoresponderId) return res.status(400).json({ ok: false, error: "autoresponder_id required" });
    if (!listId) return res.status(400).json({ ok: false, error: "list_id required" });

    // 1) Load autoresponder (your table name is email_automations)
    const { data: ar, error: arErr } = await supabaseAdmin
      .from("email_automations")
      .select("id, user_id, list_id, is_active, delay_type, delay_value, delay_days, subject, template_path, from_name, from_email, reply_to")
      .eq("id", autoresponderId)
      .single();

    if (arErr || !ar) return res.status(404).json({ ok: false, error: "Autoresponder not found" });
    if (String(ar.user_id) !== String(userId))
      return res.status(403).json({ ok: false, error: "Not allowed for this autoresponder" });

    if (String(ar.list_id) !== String(listId))
      return res.status(400).json({ ok: false, error: "list_id does not match this autoresponder" });

    if (ar.is_active === false)
      return res.status(400).json({ ok: false, error: "Autoresponder is not active" });

    // 2) Load list members (email_list_members is what your screenshots show)
    // If you only want the ones flagged autoresponder=true, keep that filter:
    const { data: members, error: mErr } = await supabaseAdmin
      .from("email_list_members")
      .select("id, list_id, lead_id, email, name, user_id, autoresponder")
      .eq("list_id", listId)
      .eq("autoresponder", true);

    if (mErr) return res.status(500).json({ ok: false, error: mErr.message || "Failed to load list members" });

    const rows = (members || [])
      .filter((m) => safeString(m.email))
      .map((m) => ({
        user_id: userId,
        autoresponder_id: autoresponderId,
        list_id: listId,
        lead_id: m.lead_id || null,
        to_email: safeString(m.email).toLowerCase(),
        to_name: safeString(m.name) || null,
        subject: safeString(ar.subject) || null,
        template_path: safeString(ar.template_path) || null,
        scheduled_at: computeScheduleIso(ar),
        status: "queued",
        attempts: 0,
        last_error: null,
        provider_message_id: null,
        sent_at: null,
      }));

    if (!rows.length) return res.status(200).json({ ok: true, added: 0, skipped: 0, note: "No eligible members (no emails)" });

    // 3) Skip duplicates:
    // We do a best-effort check: if a row already exists for (autoresponder_id + to_email) OR (autoresponder_id + lead_id)
    // because schema uniqueness varies across projects.
    const emails = rows.map((r) => r.to_email);
    const leadIds = rows.map((r) => r.lead_id).filter(Boolean);

    const { data: existing, error: eErr } = await supabaseAdmin
      .from("email_autoresponder_queue")
      .select("id, to_email, lead_id")
      .eq("autoresponder_id", autoresponderId)
      .in("to_email", emails);

    if (eErr) {
      // If this fails, we still try to insert (sender may dedupe later)
      // but we’ll avoid crashing.
      console.warn("Existing queue lookup failed:", eErr.message);
    }

    const existingEmailSet = new Set((existing || []).map((x) => safeString(x.to_email).toLowerCase()));
    const existingLeadSet = new Set((existing || []).map((x) => safeString(x.lead_id)));

    const toInsert = rows.filter((r) => {
      if (r.to_email && existingEmailSet.has(r.to_email)) return false;
      if (r.lead_id && existingLeadSet.has(String(r.lead_id))) return false;
      return true;
    });

    const skipped = rows.length - toInsert.length;
    if (!toInsert.length) return res.status(200).json({ ok: true, added: 0, skipped });

    // 4) Insert in chunks
    let added = 0;
    const parts = chunk(toInsert, 200);

    for (const part of parts) {
      const { error: insErr } = await supabaseAdmin
        .from("email_autoresponder_queue")
        .insert(part);

      if (insErr) {
        return res.status(500).json({ ok: false, error: insErr.message || "Insert into queue failed" });
      }
      added += part.length;
    }

    return res.status(200).json({ ok: true, added, skipped });
  } catch (err) {
    console.error("enroll-existing error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
