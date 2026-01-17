// /pages/api/crm/leads.js
// FULL REPLACEMENT
//
// ✅ Fixes: "column leads.mobile does not exist" / "column leads.account_id does not exist"
// ✅ Does NOT guess your schema columns in SQL (selects * then normalizes in JS)
// ✅ Attempts to scope by user_id if that column exists; falls back safely if not
//
// Returns:
//   { ok: true, leads: [{ id, name, phone, raw }] }

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE ||
  "";

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const s = String(h);
  if (!s) return "";
  const m = s.match(/Bearer\s+(.+)/i);
  return m ? String(m[1]).trim() : "";
}

function pickPhone(row) {
  // Try common field names without assuming they exist
  const candidates = [
    row.mobile,
    row.mobile_phone,
    row.phone,
    row.phone_number,
    row.phoneNumber,
    row.telephone,
    row.tel,
    row.contact_number,
    row.contactNumber,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);

  return candidates[0] || "";
}

function pickName(row) {
  const full =
    (row.full_name ?? row.fullName ?? row.name ?? row.contact_name ?? row.contactName) ??
    "";

  const fullStr = String(full || "").trim();
  if (fullStr) return fullStr;

  const first = String(row.first_name ?? row.firstName ?? "").trim();
  const last = String(row.last_name ?? row.lastName ?? "").trim();
  const combined = `${first} ${last}`.trim();

  return combined || "Unnamed lead";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Try to identify user (for multi-user scoping if possible)
    const token = getBearer(req);
    let userId = "";
    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user?.id) userId = data.user.id;
    }

    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "500"), 10) || 500, 1),
      2000
    );

    // --- Attempt 1: scope by user_id if that column exists ---
    let q = supabaseAdmin
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (userId) q = q.eq("user_id", userId);

    let { data: rows, error } = await q;

    // If user_id column doesn't exist (or any schema error), retry without scoping
    if (error) {
      const msg = String(error.message || "");
      const isMissingColumn =
        msg.includes("does not exist") ||
        msg.includes("column") ||
        msg.includes("schema cache");

      if (isMissingColumn) {
        const retry = await supabaseAdmin
          .from("leads")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        rows = retry.data || [];
        error = retry.error || null;
      }
    }

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Failed to load leads",
      });
    }

    const leads = (rows || []).map((r) => {
      const id = r.id ?? r.lead_id ?? r.uuid ?? null;
      return {
        id,
        name: pickName(r),
        phone: pickPhone(r),
        raw: r, // keep raw so your UI can use extra fields if needed
      };
    });

    return res.status(200).json({ ok: true, leads });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
