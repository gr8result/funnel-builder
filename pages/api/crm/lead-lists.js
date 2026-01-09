// /pages/api/crm/lead-lists.js
// FULL REPLACEMENT — FIXES "Server error" banner by making /api/crm/lead-lists work
//
// ✅ Returns ALL lead lists for the logged-in user (multi-tenant safe)
// ✅ Derives user from Bearer token (no query params)
// ✅ Uses service role + auth.getUser(token)
// ✅ Matches your UI expectation: { ok: true, lists: [...] }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

function s(v) {
  return String(v ?? "").trim();
}

function getBearer(req) {
  const h = s(req.headers?.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return s(h.slice(7));
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ ok: false, error: "GET only" });
  }

  try {
    const sb = admin();

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session token" });
    }

    const uid = userData.user.id;

    const { data, error } = await sb
      .from("lead_lists")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message || String(error) });
    }

    return res.status(200).json({ ok: true, lists: data || [] });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: e?.message || String(e),
    });
  }
}
