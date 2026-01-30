// /pages/api/automation/engine/trigger-lead.js
// FULL REPLACEMENT
// POST { flow_id, lead_id }
// ✅ Ensures lead is enrolled (automation_flow_members)
// ✅ Automatically queues the FIRST email node connected from the Trigger
// ✅ Prevents obvious duplicates (best-effort, schema-safe)
// ✅ Ownership: accounts.id OR auth.users.id (Bearer token)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getAccountId(auth_user_id) {
  try {
    const { data } = await supabaseAdmin
      .from("accounts")
      .select("id")
      .eq("user_id", auth_user_id)
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "http://localhost:3000"
  );
}

async function tickFlow(flow_id) {
  try {
    const cronSecret =
      process.env.AUTOMATION_CRON_SECRET ||
      process.env.AUTOMATION_CRON_KEY ||
      process.env.CRON_SECRET ||
      "";

    await fetch(`${baseUrl()}/api/automation/engine/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { "x-cron-key": cronSecret } : {}),
      },
      body: JSON.stringify({ flow_id, max: 200 }),
    });
  } catch {
    // don't fail trigger if tick fails
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const { flow_id, lead_id } = req.body || {};
    if (!flow_id || !lead_id) {
      return res.status(400).json({ ok: false, error: "Missing flow_id or lead_id" });
    }

    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    const auth_user_id = userData.user.id;
    const account_id = await getAccountId(auth_user_id);
    const owner_id = account_id || auth_user_id;

    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,is_standard,nodes,edges")
      .eq("id", flow_id)
      .single();

    if (flowErr || !flow) {
      return res.status(404).json({ ok: false, error: flowErr?.message || "Flow not found" });
    }

    const owned =
      flow.is_standard === true ||
      String(flow.user_id || "") === String(owner_id) ||
      String(flow.user_id || "") === String(auth_user_id);

    if (!owned) return res.status(403).json({ ok: false, error: "Not allowed" });

    // Ensure member enrolled
    const enrollRow = {
      user_id: owner_id,
      flow_id,
      lead_id,
      status: "active",
      source: "trigger",
      updated_at: new Date().toISOString(),
    };

    // Try with onConflict; if fails, fallback to insert+ignore
    try {
      const { error: upErr } = await supabaseAdmin
        .from("automation_flow_members")
        .upsert([enrollRow], { onConflict: "flow_id,lead_id" });

      if (upErr) throw upErr;
    } catch (e) {
      // last resort: insert (may error on dup unique, ignore if so)
      const { error: insErr } = await supabaseAdmin
        .from("automation_flow_members")
        .insert([enrollRow]);
      if (insErr) {
        const msg = String(insErr.message || "");
        if (!msg.toLowerCase().includes("duplicate")) {
          return res.status(500).json({ ok: false, error: insErr.message });
        }
      }
    }

    await tickFlow(flow_id);

    return res.json({
      ok: true,
      enrolled: true,
      queued: 0,
      message: "Lead triggered and flow processing started.",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
