// /pages/api/email/autoresponders/save.js
// FULL REPLACEMENT — server-side save (bypasses RLS) + returns saved row
//
// POST /api/email/autoresponders/save
// Headers: Authorization: Bearer <user_jwt>
//
// Body:
// {
//   autoresponder_id?: string,
//   name: string,
//   trigger_type: string,
//   send_day: string,
//   send_time: string,
//   active_days: string[],
//   from_name: string,
//   from_email: string,
//   reply_to: string,
//   subject: string,
//   list_id: string,
//   template_path: string
// }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const SERVICE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE ||
    "").trim();

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function getBearer(req) {
  const raw = String(req.headers?.authorization || "");
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res
      .status(500)
      .json({ ok: false, error: "Missing SUPABASE_URL or SERVICE_ROLE key env vars" });
  }

  const token = getBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user) return res.status(401).json({ ok: false, error: "Invalid session" });
    const user_id = u.user.id;

    const body = req.body || {};
    const autoresponder_id = body.autoresponder_id ? String(body.autoresponder_id) : null;

    const payload = {
      user_id,
      name: String(body.name || "").trim(),
      trigger_type: String(body.trigger_type || "After Signup"),
      send_day: String(body.send_day || "Same day as trigger"),
      send_time: String(body.send_time || "Same as signup time"),
      active_days: Array.isArray(body.active_days) ? body.active_days : ["Mon", "Tue", "Wed", "Thu", "Fri"],
      from_name: String(body.from_name || "").trim(),
      from_email: String(body.from_email || "").trim(),
      reply_to: String(body.reply_to || "").trim(),
      subject: String(body.subject || "").trim(),
      list_id: String(body.list_id || "").trim() || null,
      template_path: String(body.template_path || "").trim() || null,
      template_id: null, // IMPORTANT: do not write path into UUID column
      updated_at: new Date().toISOString(),
    };

    if (!payload.name) return res.status(400).json({ ok: false, error: "Missing name" });
    if (!payload.subject) return res.status(400).json({ ok: false, error: "Missing subject" });
    if (!payload.list_id) return res.status(400).json({ ok: false, error: "Missing list_id" });
    if (!payload.template_path) return res.status(400).json({ ok: false, error: "Missing template_path" });

    if (autoresponder_id) {
      const { data, error } = await supabase
        .from("email_automations")
        .update(payload)
        .eq("id", autoresponder_id)
        .eq("user_id", user_id)
        .select()
        .single();

      if (error) return res.status(500).json({ ok: false, error: msg(error) });
      return res.json({ ok: true, data });
    }

    const { data, error } = await supabase
      .from("email_automations")
      .insert([{ ...payload, created_at: new Date().toISOString() }])
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, error: msg(error) });
    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
