// /pages/api/automation/flow-members.js
// FULL REPLACEMENT (FIXES members showing 0 after import)
// GET /api/automation/flow-members?flow_id=...
//
// ✅ Works whether automation_flow_members uses user_id OR account_id OR neither
// ✅ Works whether leads uses user_id OR account_id OR neither
// ✅ Uses Bearer token to identify the current user, then matches by (user_id OR account_id)
// ✅ Keeps response shape: { ok, members, count } (+debug for troubleshooting)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getBearer(req) {
  const h = req.headers?.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function isMissingColumn(err) {
  const m = msg(err).toLowerCase();
  return m.includes("column") && m.includes("does not exist");
}

function isMissingTable(err) {
  const m = msg(err).toLowerCase();
  return (
    err?.code === "42P01" ||
    m.includes("relation") ||
    m.includes("does not exist")
  );
}

// Probe whether a column exists by trying a tiny select.
// If missing column -> false. If table missing -> throw so caller can handle.
async function hasColumn(table, col) {
  const { error } = await admin.from(table).select(col).limit(1);
  if (!error) return true;
  if (isMissingColumn(error)) return false;
  if (isMissingTable(error)) throw error;
  return false;
}

async function getAccountIdForUser(user_id) {
  if (!user_id) return null;
  const { data, error } = await admin
    .from("accounts")
    .select("id")
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) return null;
  return data?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "GET only" });

  const debug = {
    uid: null,
    account_id: null,
    automation_flow_members: { has_user_id: null, has_account_id: null },
    leads: { has_user_id: null, has_account_id: null },
    memberStrategy: null,
    leadStrategy: null,
  };

  try {
    const token = getBearer(req);
    if (!token)
      return res.status(401).json({ ok: false, error: "Missing bearer token" });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }
    const uid = userData.user.id;
    debug.uid = uid;

    const account_id = await getAccountIdForUser(uid);
    debug.account_id = account_id;

    const flow_id = String(req.query?.flow_id || "").trim();
    if (!flow_id)
      return res.status(400).json({ ok: false, error: "flow_id is required" });

    // Detect ownership columns (tolerant)
    try {
      debug.automation_flow_members.has_user_id = await hasColumn(
        "automation_flow_members",
        "user_id"
      );
    } catch (e) {
      if (isMissingTable(e)) {
        return res
          .status(500)
          .json({ ok: false, error: "automation_flow_members table missing" });
      }
      debug.automation_flow_members.has_user_id = false;
    }

    try {
      debug.automation_flow_members.has_account_id = await hasColumn(
        "automation_flow_members",
        "account_id"
      );
    } catch (e) {
      debug.automation_flow_members.has_account_id = false;
    }

    try {
      debug.leads.has_user_id = await hasColumn("leads", "user_id");
    } catch (e) {
      debug.leads.has_user_id = false;
    }

    try {
      debug.leads.has_account_id = await hasColumn("leads", "account_id");
    } catch (e) {
      debug.leads.has_account_id = false;
    }

    // Build members query safely
    let memQ = admin
      .from("automation_flow_members")
      .select("id,flow_id,lead_id,status,created_at")
      .eq("flow_id", flow_id)
      .order("created_at", { ascending: false });

    const hasMemUser = !!debug.automation_flow_members.has_user_id;
    const hasMemAcct = !!debug.automation_flow_members.has_account_id;

    if (hasMemUser && hasMemAcct && account_id) {
      // Match either owner column
      memQ = memQ.or(`user_id.eq.${uid},account_id.eq.${account_id}`);
      debug.memberStrategy = "members: (user_id OR account_id)";
    } else if (hasMemUser) {
      memQ = memQ.eq("user_id", uid);
      debug.memberStrategy = "members: user_id";
    } else if (hasMemAcct && account_id) {
      memQ = memQ.eq("account_id", account_id);
      debug.memberStrategy = "members: account_id";
    } else {
      debug.memberStrategy = "members: no owner filter";
    }

    const { data: mem, error: memErr } = await memQ;
    if (memErr)
      return res.status(500).json({ ok: false, error: msg(memErr), debug });

    const leadIds = (mem || []).map((m) => m.lead_id).filter(Boolean);

    // Load leads (tolerant)
    let leadMap = new Map();
    if (leadIds.length) {
      let leadQ = admin.from("leads").select("id,name,email,phone").in("id", leadIds);

      const hasLeadUser = !!debug.leads.has_user_id;
      const hasLeadAcct = !!debug.leads.has_account_id;

      if (hasLeadUser && hasLeadAcct && account_id) {
        leadQ = leadQ.or(`user_id.eq.${uid},account_id.eq.${account_id}`);
        debug.leadStrategy = "leads: (user_id OR account_id)";
      } else if (hasLeadUser) {
        leadQ = leadQ.eq("user_id", uid);
        debug.leadStrategy = "leads: user_id";
      } else if (hasLeadAcct && account_id) {
        leadQ = leadQ.eq("account_id", account_id);
        debug.leadStrategy = "leads: account_id";
      } else {
        debug.leadStrategy = "leads: no owner filter";
      }

      const { data: leads, error: lErr } = await leadQ;
      if (!lErr && Array.isArray(leads) && leads.length) {
        leadMap = new Map(leads.map((l) => [l.id, l]));
      }
    }

    const merged = (mem || []).map((m) => {
      const l = leadMap.get(m.lead_id) || {};
      return {
        id: m.id,
        flow_id: m.flow_id,
        lead_id: m.lead_id,
        status: m.status,
        created_at: m.created_at,
        name: l.name || null,
        email: l.email || null,
        phone: l.phone || null,
      };
    });

    return res.json({ ok: true, members: merged, count: merged.length, debug });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e), debug });
  }
}
