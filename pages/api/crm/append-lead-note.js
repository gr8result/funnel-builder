// /pages/api/crm/append-lead-note.js
// NEW FILE
//
// ✅ Appends a timestamped note into leads.notes
// ✅ Safe: uses service role
//
// Required env:
// - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

function pickEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

const SUPABASE_URL = pickEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
const SERVICE_KEY = pickEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ ok: false, error: "Supabase admin not configured" });
  }

  const leadId = String(req.body?.leadId || "").trim();
  const note = String(req.body?.note || "").trim();

  if (!leadId) return res.status(400).json({ ok: false, error: "Missing leadId" });
  if (!note) return res.status(400).json({ ok: false, error: "Missing note" });

  try {
    const { data: lead, error: selErr } = await supabaseAdmin
      .from("leads")
      .select("id, notes")
      .eq("id", leadId)
      .single();

    if (selErr) throw selErr;

    const prev = String(lead?.notes || "");
    const merged = prev ? `${prev}\n\n${note}` : note;

    const { error: updErr } = await supabaseAdmin.from("leads").update({ notes: merged }).eq("id", leadId);
    if (updErr) throw updErr;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[/api/crm/append-lead-note] error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
