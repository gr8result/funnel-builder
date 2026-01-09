// /pages/api/automation/lists.js
// FULL REPLACEMENT
//
// ✅ Loads lists for Automation Members modal
// ✅ DOES NOT assume user_id/account_id columns exist
// ✅ Probes columns safely, then applies the best owner filter available
// ✅ Supports BOTH tables: email_lists, lead_lists
// ✅ Returns debug so we can SEE why it returns zero

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function msg(err) {
  return err?.message || err?.error_description || String(err || "");
}

function isMissingTable(err) {
  const m = msg(err).toLowerCase();
  return (
    err?.code === "42P01" ||
    m.includes("does not exist") ||
    m.includes("relation")
  );
}

function isMissingColumn(err) {
  const m = msg(err).toLowerCase();
  return m.includes("column") && m.includes("does not exist");
}

async function getUserIdFromRequest(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error) return null;
  return data?.user?.id || null;
}

async function getAccountIdForUser(user_id) {
  if (!user_id) return null;
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id")
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) return null;
  return data?.id || null;
}

// Probe whether a column exists by trying a tiny select.
// If missing column -> false. If table missing -> throw (caller handles).
async function hasColumn(table, col) {
  const { error } = await supabaseAdmin.from(table).select(col).limit(1);
  if (!error) return true;
  if (isMissingColumn(error)) return false;
  if (isMissingTable(error)) throw error;
  // Other errors: treat as "unknown" but don't assume column exists.
  return false;
}

async function loadFromTable(table, user_id, account_id) {
  const debug = {
    table,
    exists: true,
    has_user_id: false,
    has_account_id: false,
    strategy: null,
    count: 0,
    error: null,
  };

  try {
    debug.has_user_id = await hasColumn(table, "user_id");
  } catch (e) {
    if (isMissingTable(e)) {
      debug.exists = false;
      return { ok: true, rows: [], debug };
    }
    debug.has_user_id = false;
  }

  try {
    debug.has_account_id = await hasColumn(table, "account_id");
  } catch (e) {
    if (isMissingTable(e)) {
      debug.exists = false;
      return { ok: true, rows: [], debug };
    }
    debug.has_account_id = false;
  }

  // Always select only the columns we know exist (plus id/name which we assume)
  const selectCols = ["id", "name"];
  if (debug.has_user_id) selectCols.push("user_id");
  if (debug.has_account_id) selectCols.push("account_id");

  // 1) Prefer filtering by account_id (if present) because your app uses accounts a lot
  if (debug.has_account_id && account_id) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectCols.join(","))
      .eq("account_id", account_id)
      .order("name", { ascending: true });

    if (!error && Array.isArray(data)) {
      debug.strategy = "account_id";
      debug.count = data.length;
      return { ok: true, rows: data, debug };
    }

    debug.error = error ? msg(error) : null;
  }

  // 2) Next: filter by user_id (if present)
  if (debug.has_user_id && user_id) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectCols.join(","))
      .eq("user_id", user_id)
      .order("name", { ascending: true });

    if (!error && Array.isArray(data)) {
      debug.strategy = "user_id";
      debug.count = data.length;
      return { ok: true, rows: data, debug };
    }

    debug.error = error ? msg(error) : debug.error;
  }

  // 3) Last resort: no owner columns exist => just return all (limited)
  {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectCols.join(","))
      .order("name", { ascending: true })
      .limit(200);

    if (error) {
      debug.strategy = "all_failed";
      debug.error = msg(error);
      return { ok: false, rows: [], debug };
    }

    debug.strategy = "all";
    debug.count = Array.isArray(data) ? data.length : 0;
    return { ok: true, rows: data || [], debug };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });

  try {
    if (!SUPABASE_URL) {
      return res.status(500).json({ ok: false, error: "SUPABASE_URL missing" });
    }
    if (!SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY missing" });
    }
    if (!ANON_KEY) {
      return res.status(500).json({ ok: false, error: "NEXT_PUBLIC_SUPABASE_ANON_KEY missing" });
    }

    const user_id = await getUserIdFromRequest(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Missing/invalid auth" });

    const account_id = await getAccountIdForUser(user_id);

    const debug = {
      owner: { user_id, account_id: account_id || null },
      tables: [],
    };

    const out = [];

    for (const table of ["email_lists", "lead_lists"]) {
      const r = await loadFromTable(table, user_id, account_id);
      debug.tables.push(r.debug);

      (r.rows || []).forEach((x) => {
        if (!x?.id) return;
        out.push({
          id: x.id,
          name: x.name || "Untitled List",
          source: table,
        });
      });
    }

    // Dedup
    const seen = new Set();
    const lists = [];
    for (const x of out) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      lists.push(x);
    }

    return res.json({ ok: true, lists, count: lists.length, debug });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
