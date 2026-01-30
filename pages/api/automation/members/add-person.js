// /pages/api/automation/members/add-person.js
// FULL REPLACEMENT
// POST { flow_id, lead_id?, name?, email?, phone? }
//
// ✅ Adds ONE lead to the flow (either existing lead_id OR creates/finds by email/phone)
// ✅ Writes to automation_flow_members
// ✅ ALSO creates/updates automation_flow_runs so the flow actually STARTS
// ✅ Auto-ticks the engine after enrollment (so it begins immediately)
// ✅ Safe: derives user from Bearer token

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

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "http://localhost:3000"
  );
}

async function tickFlow(flow_id) {
  try {
    await fetch(`${baseUrl()}/api/automation/engine/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id, max: 200 }),
    });
  } catch {
    // do not fail enrollment if tick fails
  }
}

async function ensureOneRun({ flow_id, user_id, lead_id }) {
  const now = new Date().toISOString();

  // Try upsert fast; fallback if constraint missing
  try {
    const { error: upErr } = await supabaseAdmin
      .from("automation_flow_runs")
      .upsert(
        [
          {
            user_id,
            flow_id,
            lead_id,
            status: "active",
            current_node_id: null,
            available_at: null,
            waiting_for: null,
            waiting_token: null,
            waiting_node_id: null,
            last_error: null,
            updated_at: now,
          },
        ],
        { onConflict: "flow_id,lead_id" }
      );

    if (!upErr) return { ok: true, created: 0, updated: 1 };

    const msg = String(upErr.message || "").toLowerCase();
    const noConstraint =
      msg.includes("no unique") ||
      msg.includes("no exclusion constraint") ||
      msg.includes("on conflict");
    if (!noConstraint) throw upErr;
  } catch {
    // Manual fallback: check exists then insert/update
    const { data: ex, error: exErr } = await supabaseAdmin
      .from("automation_flow_runs")
      .select("id")
      .eq("flow_id", flow_id)
      .eq("user_id", user_id)
      .eq("lead_id", lead_id)
      .maybeSingle();

    if (exErr) throw exErr;

    if (!ex) {
      const { error: insErr } = await supabaseAdmin
        .from("automation_flow_runs")
        .insert([
          {
            user_id,
            flow_id,
            lead_id,
            status: "active",
            current_node_id: null,
            available_at: null,
            waiting_for: null,
            waiting_token: null,
            waiting_node_id: null,
            last_error: null,
            created_at: now,
            updated_at: now,
          },
        ]);
      if (insErr) throw insErr;
      return { ok: true, created: 1, updated: 0 };
    }

    const { error: updErr } = await supabaseAdmin
      .from("automation_flow_runs")
      .update({
        status: "active",
        current_node_id: null,
        available_at: null,
        waiting_for: null,
        waiting_token: null,
        waiting_node_id: null,
        last_error: null,
        updated_at: now,
      })
      .eq("flow_id", flow_id)
      .eq("user_id", user_id)
      .eq("lead_id", lead_id);

    if (updErr) throw updErr;
    return { ok: true, created: 0, updated: 1 };
  }

  return { ok: true, created: 0, updated: 1 };
}

function cleanStr(v) {
  const s = String(v || "").trim();
  return s ? s : "";
}
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Use POST" });
    }

    const token = getBearer(req);
    if (!token)
      return res
        .status(401)
        .json({ ok: false, error: "Missing Bearer token" });

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }
    const user_id = userData.user.id;

    const flow_id = cleanStr(req.body?.flow_id);
    let lead_id = cleanStr(req.body?.lead_id);

    const name = cleanStr(req.body?.name);
    const email = cleanStr(req.body?.email);
    const phone = cleanStr(req.body?.phone);

    if (!flow_id)
      return res.status(400).json({ ok: false, error: "Missing flow_id" });

    // Resolve / create lead
    if (!lead_id) {
      // Need at least email OR phone to find/create
      if (!email && !phone) {
        return res.status(400).json({
          ok: false,
          error: "Provide lead_id OR at least email/phone to add a person.",
        });
      }

      if (email && !isEmail(email)) {
        return res.status(400).json({ ok: false, error: "Invalid email format" });
      }

      // Find existing lead by email/phone (same user)
      let found = null;

      if (email) {
        const { data, error } = await supabaseAdmin
          .from("leads")
          .select("id")
          .eq("user_id", user_id)
          .eq("email", email)
          .maybeSingle();

        if (error) {
          return res.status(500).json({ ok: false, error: error.message, detail: error });
        }
        if (data?.id) found = data;
      }

      if (!found && phone) {
        const { data, error } = await supabaseAdmin
          .from("leads")
          .select("id")
          .eq("user_id", user_id)
          .eq("phone", phone)
          .maybeSingle();

        if (error) {
          return res.status(500).json({ ok: false, error: error.message, detail: error });
        }
        if (data?.id) found = data;
      }

      if (found?.id) {
        lead_id = found.id;
      } else {
        // Create new lead
        const { data: ins, error: insErr } = await supabaseAdmin
          .from("leads")
          .insert([
            {
              user_id,
              name: name || null,
              email: email || null,
              phone: phone || null,
              created_at: new Date().toISOString(),
            },
          ])
          .select("id")
          .single();

        if (insErr) {
          return res.status(500).json({ ok: false, error: insErr.message, detail: insErr });
        }

        lead_id = ins?.id || "";
      }
    }

    if (!lead_id) {
      return res.status(500).json({ ok: false, error: "Could not resolve lead_id" });
    }

    // Confirm lead belongs to user
    const { data: leadRow, error: leadErr } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("id", lead_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (leadErr) {
      return res.status(500).json({ ok: false, error: leadErr.message, detail: leadErr });
    }
    if (!leadRow) {
      return res.status(404).json({ ok: false, error: "Lead not found for this user" });
    }

    // 1) Enroll member
    try {
      const { error: upErr } = await supabaseAdmin
        .from("automation_flow_members")
        .upsert(
          [
            {
              user_id,
              flow_id,
              lead_id,
              status: "active",
              source: req.body?.lead_id ? "crm" : "manual",
            },
          ],
          { onConflict: "flow_id,lead_id" }
        );
      if (upErr) throw upErr;
    } catch {
      // fallback: insert if missing
      const { data: ex, error: exErr } = await supabaseAdmin
        .from("automation_flow_members")
        .select("lead_id")
        .eq("flow_id", flow_id)
        .eq("user_id", user_id)
        .eq("lead_id", lead_id)
        .maybeSingle();

      if (exErr) {
        return res.status(500).json({ ok: false, error: exErr.message, detail: exErr });
      }

      if (!ex) {
        const { error: insErr } = await supabaseAdmin
          .from("automation_flow_members")
          .insert([
            {
              user_id,
              flow_id,
              lead_id,
              status: "active",
              source: req.body?.lead_id ? "crm" : "manual",
            },
          ]);
        if (insErr) {
          return res.status(500).json({ ok: false, error: insErr.message, detail: insErr });
        }
      }
    }

    // 2) Ensure run exists and is ACTIVE (this is what actually makes the flow move)
    const runInfo = await ensureOneRun({ flow_id, user_id, lead_id });

    // 3) Queue the first email node after trigger (if it exists)
    try {
      const { data: flow, error: flowErr } = await supabaseAdmin
        .from("automation_flows")
        .select("nodes,edges")
        .eq("id", flow_id)
        .single();

      if (!flowErr && flow) {
        const nodes = (() => {
          try {
            const n = flow.nodes;
            return typeof n === 'string' ? JSON.parse(n) : (Array.isArray(n) ? n : []);
          } catch {
            return [];
          }
        })();
        
        const edges = (() => {
          try {
            const e = flow.edges;
            return typeof e === 'string' ? JSON.parse(e) : (Array.isArray(e) ? e : []);
          } catch {
            return [];
          }
        })();

        // Find trigger and first email after it
        const trigger = nodes.find(n => n?.type === "trigger");
        if (trigger) {
          const firstEdge = edges.find(e => e?.source === trigger.id);
          if (firstEdge) {
            const firstEmail = nodes.find(n => n?.id === firstEdge.target && n?.type === "email");
            if (firstEmail) {
              const { data: leadData } = await supabaseAdmin
                .from("leads")
                .select("email")
                .eq("id", lead_id)
                .single();

              if (leadData?.email) {
                const emailNodeData = firstEmail?.data || {};
                const now = new Date().toISOString();
                
                await supabaseAdmin.from("automation_email_queue").insert([{
                  user_id,
                  lead_id,
                  flow_id,
                  node_id: firstEmail.id,
                  to_email: leadData.email,
                  subject: emailNodeData.subject || emailNodeData.label || "Message",
                  html_content: "",
                  html_path: emailNodeData.htmlPath || emailNodeData.storagePath || "",
                  bucket: emailNodeData.bucket || "email-user-assets",
                  variant: emailNodeData.label || emailNodeData.name || "Email",
                  status: "pending",
                  created_at: now,
                  updated_at: now,
                }]);
              }
            }
          }
        }
      }
    } catch {
      // if email queuing fails, don't fail the enrollment
    }

    // 4) Kick the engine once so it starts immediately
    await tickFlow(flow_id);

    return res.status(200).json({
      ok: true,
      lead_id,
      runs_created: runInfo.created,
      runs_updated: runInfo.updated,
      note: "Member enrolled + run activated + engine ticked.",
    });
  } catch (err) {
    console.error("add-person error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
