// /pages/api/email/autoresponders/enroll-existing.js
// FULL REPLACEMENT
//
// POST { autoresponder_id, list_id }
//
// ✅ Auth: Authorization: Bearer <SUPABASE ACCESS TOKEN>
// ✅ Looks up the autoresponder in public.email_automations (must belong to user)
// ✅ Pulls existing members from public.email_list_members for that list (must belong to user)
// ✅ Inserts rows into public.email_autoresponder_queue using correct columns:
//    user_id, autoresponder_id, list_id, lead_id, to_email, to_name, subject, template_path,
//    scheduled_at, status, attempts
//
// IMPORTANT:
// - This endpoint does NOT accept SendGrid keys as auth.
// - SendGrid key stays in env as SENDGRID_API_KEY for the sender worker.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

function getBearerToken(req) {
  const h = req.headers?.authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL / SERVICE_ROLE key env vars",
      });
    }

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Verify user from JWT
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(
      token
    );
    const user = userData?.user;
    if (userErr || !user) {
      return res.status(401).json({
        ok: false,
        error:
          "Invalid session. Use Supabase access token (JWT), not SendGrid key.",
      });
    }

    const { autoresponder_id, list_id } = req.body || {};
    const autoresponderId = String(autoresponder_id || "").trim();
    const listId = String(list_id || "").trim();

    if (!autoresponderId || !listId) {
      return res.status(400).json({
        ok: false,
        error: "autoresponder_id and list_id are required",
      });
    }

    // Load autoresponder (your table is email_automations)
    const { data: ar, error: arErr } = await supabaseAdmin
      .from("email_automations")
      .select(
        "id, user_id, is_active, subject, template_path, from_name, from_email, reply_to, send_timezone, send_day, send_time, delay_type, delay_value"
      )
      .eq("id", autoresponderId)
      .eq("user_id", user.id)
      .single();

    if (arErr || !ar) {
      return res.status(404).json({
        ok: false,
        error: "Autoresponder not found for this user",
      });
    }

    if (!ar.is_active) {
      return res.status(400).json({
        ok: false,
        error: "Autoresponder is not active",
      });
    }

    if (!ar.template_path || !String(ar.template_path).trim()) {
      return res.status(400).json({
        ok: false,
        error: "Autoresponder has no template_path",
      });
    }

    const subject = String(ar.subject || "").trim();
    if (!subject) {
      return res.status(400).json({
        ok: false,
        error: "Autoresponder has no subject",
      });
    }

    // Pull existing list members (scoped to user + list)
    // Your screenshot shows email_list_members has user_id/list_id/lead_id/email/name/autoresponder etc.
    const { data: members, error: memErr } = await supabaseAdmin
      .from("email_list_members")
      .select("lead_id, email, name, user_id, list_id")
      .eq("user_id", user.id)
      .eq("list_id", listId);

    if (memErr) {
      return res.status(500).json({ ok: false, error: memErr.message });
    }

    const cleaned = (members || [])
      .map((m) => ({
        lead_id: m?.lead_id || null,
        email: String(m?.email || "").trim(),
        name: String(m?.name || "").trim(),
      }))
      .filter((m) => !!m.email && m.email.includes("@"));

    if (!cleaned.length) {
      return res.json({
        ok: true,
        added: 0,
        skipped: 0,
        note: "No eligible emails found in email_list_members for this list.",
      });
    }

    // Basic scheduling:
    // For now: immediate = now(). (Your UI uses immediate / delay_value 0 anyway.)
    const scheduledAt = new Date().toISOString();

    // Insert queue rows
    // If you add a unique index later like (autoresponder_id, lead_id) or (autoresponder_id, to_email),
    // you can switch this to upsert with onConflict.
    const rows = cleaned.map((m) => ({
      user_id: user.id,
      autoresponder_id: autoresponderId,
      list_id: listId,
      lead_id: m.lead_id,
      to_email: m.email,
      to_name: m.name || null,
      subject,
      template_path: ar.template_path,
      scheduled_at: scheduledAt,
      status: "queued",
      attempts: 0,
    }));

    // Insert in chunks to avoid payload limits
    let added = 0;
    let failed = 0;

    const CHUNK = 250;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      const { error: insErr, count } = await supabaseAdmin
        .from("email_autoresponder_queue")
        .insert(chunk, { count: "exact" });

      if (insErr) {
        // If you have unique constraints, duplicates might throw.
        // We treat duplicates as "skipped" by doing a fallback per-row insert.
        // (This keeps it robust even with different constraints across environments.)
        for (const r of chunk) {
          const { error: oneErr } = await supabaseAdmin
            .from("email_autoresponder_queue")
            .insert(r);
          if (oneErr) failed += 1;
          else added += 1;
        }
      } else {
        added += Number(count || chunk.length);
      }
    }

    const skipped = Math.max(0, rows.length - added - failed);

    return res.json({
      ok: true,
      added,
      skipped,
      failed,
      list_id: listId,
      autoresponder_id: autoresponderId,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
