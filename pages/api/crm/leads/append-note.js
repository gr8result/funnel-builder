// /pages/api/crm/leads/append-note.js
// FULL REPLACEMENT
// POST { lead_id, note }
// ✅ Appends note to leads.notes with timestamp
// ✅ Safe: verifies lead belongs to logged-in user using Bearer token user_id match

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function stamp() {
  return new Date().toLocaleString("en-AU", { hour12: true });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  try {
    const { lead_id, note } = req.body || {};
    const id = String(lead_id || "").trim();
    const text = String(note || "").trim();

    if (!id) return res.status(400).json({ ok: false, error: "lead_id required" });
    if (!text) return res.status(400).json({ ok: false, error: "note required" });

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "Supabase env missing" });
    }

    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    // Get logged-in user id (RLS-safe)
    const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    });

    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }
    const userId = userData.user.id;

    // Service role to update notes, but we VERIFY user_id matches first
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: row, error: readErr } = await admin
      .from("leads")
      .select("id,user_id,notes")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return res.status(500).json({ ok: false, error: readErr.message });
    if (!row) return res.status(404).json({ ok: false, error: "Lead not found" });

    if (row.user_id && String(row.user_id) !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Not your lead" });
    }

    const existing = typeof row.notes === "string" ? row.notes : "";
    const next = `${existing ? existing.trimEnd() + "\n\n" : ""}[${stamp()}] ${text}`.trim();

    const { error: updErr } = await admin.from("leads").update({ notes: next }).eq("id", id);
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
