// /pages/api/email/autoresponders/save.js
// FULL REPLACEMENT — Save autoresponder into email_automations (server-side, RLS-safe)
//
// POST body:
//  - autoresponder_id? (if editing)
//  - name, trigger_type, send_day, send_time, active_days
//  - from_name, from_email, reply_to
//  - subject, list_id, template_path
//
// ✅ Uses service role to write
// ✅ Still verifies user via Bearer token and forces user_id
// ✅ Returns { ok:true, data:{id} }

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

function s(v) {
  return String(v ?? "").trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { data: u, error: uErr } = await supabaseAdmin.auth.getUser(token);
    if (uErr || !u?.user) return res.status(401).json({ ok: false, error: "Invalid token" });
    const userId = u.user.id;

    const body = req.body || {};

    const autoresponderId = s(body.autoresponder_id) || null;

    const payload = {
      user_id: userId,
      name: s(body.name),
      trigger_type: s(body.trigger_type) || "After Signup",
      send_day: s(body.send_day) || "Same day as trigger",
      send_time: s(body.send_time) || "Same as signup time",
      active_days: Array.isArray(body.active_days) ? body.active_days : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      from_name: s(body.from_name),
      from_email: s(body.from_email),
      reply_to: s(body.reply_to),
      subject: s(body.subject),
      list_id: s(body.list_id),
      template_path: s(body.template_path),
      is_active: true,
      updated_at: new Date().toISOString(),
      status: "draft",
      trigger: "manual",
      steps: Array.isArray(body.steps) ? body.steps : [],
      delay_type: s(body.delay_type) || (Number(body.delay_days || body.delay_value || 0) > 0 ? "days" : "immediate"),
      delay_days: Number(body.delay_days ?? body.delay_value ?? 0) || 0,
      delay_value: Number(body.delay_value ?? body.delay_days ?? 0) || 0,
      send_timezone: s(body.send_timezone) || "Australia/Sydney",
    };

    if (!payload.name) return res.status(400).json({ ok: false, error: "name required" });
    if (!payload.subject) return res.status(400).json({ ok: false, error: "subject required" });
    if (!payload.list_id) return res.status(400).json({ ok: false, error: "list_id required" });
    if (!payload.template_path) return res.status(400).json({ ok: false, error: "template_path required" });

    let saved;

    if (autoresponderId) {
      // Update (must belong to user)
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("email_automations")
        .select("id, user_id")
        .eq("id", autoresponderId)
        .single();

      if (exErr || !existing) return res.status(404).json({ ok: false, error: "Autoresponder not found" });
      if (String(existing.user_id) !== String(userId))
        return res.status(403).json({ ok: false, error: "Not allowed" });

      const { data, error } = await supabaseAdmin
        .from("email_automations")
        .update(payload)
        .eq("id", autoresponderId)
        .select("id")
        .single();

      if (error) return res.status(500).json({ ok: false, error: error.message });
      saved = data;
    } else {
      // Insert
      const { data, error } = await supabaseAdmin
        .from("email_automations")
        .insert(payload)
        .select("id")
        .single();

      if (error) return res.status(500).json({ ok: false, error: error.message });
      saved = data;
    }

    return res.status(200).json({ ok: true, data: { id: saved.id } });
  } catch (err) {
    console.error("save autoresponder error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
