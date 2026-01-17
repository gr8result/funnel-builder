// /pages/api/email/automations/worker.js
// FULL REPLACEMENT — Fixes automation_queue UNIQUE constraint duplicate failures
//
// ✅ Reads due jobs: status='pending' AND run_at <= now()
// ✅ Multi-tenant safe (brand/from via accounts.user_id = auth uid)
// ✅ Supports jobs missing next_node_id (derives start node from Trigger → first edge)
// ✅ Sends Email nodes via SendGrid
// ✅ Delay nodes schedule next node in the future
// ✅ Condition nodes default to "no" branch (until tracking is wired)
// ✅ CRITICAL FIX: If enqueueNext hits UNIQUE constraint (duplicate key), we treat it as OK
//    so the email still sends and the job does NOT fail.
//
// NOTE: Does NOT touch autoresponder/broadcast/campaign modules.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const SENDGRID_KEY =
  process.env.GR8_MAIL_SEND_ONLY || process.env.SENDGRID_API_KEY;

// Safe defaults (still used if no account-specific settings exist)
const DEFAULT_FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL || "no-reply@gr8result.com";
const DEFAULT_FROM_NAME =
  process.env.SENDGRID_FROM_NAME || "GR8 RESULT";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isUuid(v) {
  const s = String(v || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

function safeJsonParse(v, fallback) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v ?? fallback;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

// Your automation_flows table is:
// id uuid
// user_id uuid (FK to accounts.id, NOT auth.users)
// nodes jsonb
// edges jsonb
async function loadFlow(flow_id) {
  const { data, error } = await supabaseAdmin
    .from("automation_flows")
    .select("id,user_id,name,nodes,edges,updated_at")
    .eq("id", flow_id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: "Flow not found" };

  const nodes = safeJsonParse(data.nodes, []);
  const edges = safeJsonParse(data.edges, []);

  return {
    ok: true,
    flow: {
      id: data.id,
      name: data.name || "",
      account_id: data.user_id || null, // accounts.id
      nodes: Array.isArray(nodes) ? nodes : [],
      edges: Array.isArray(edges) ? edges : [],
      updated_at: data.updated_at,
    },
  };
}

// Multi-tenant FROM settings:
// We assume you have an "accounts" table with at least:
// - user_id (auth uid)
// and possibly fields like brand_name/business_name/from_email/from_name
async function loadAccountBrandByAuthUser(authUserId) {
  if (!isUuid(authUserId)) {
    return {
      fromEmail: DEFAULT_FROM_EMAIL,
      fromName: DEFAULT_FROM_NAME,
      brandDebug: { used: "defaults", reason: "job.user_id not uuid" },
    };
  }

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("*")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (error || !data) {
    return {
      fromEmail: DEFAULT_FROM_EMAIL,
      fromName: DEFAULT_FROM_NAME,
      brandDebug: {
        used: "defaults",
        reason: error?.message || "No accounts row for user_id",
      },
    };
  }

  // Try common column names you may have (your screenshots show some may NOT exist, so keep it defensive)
  const fromEmail =
    data.sendgrid_from_email ||
    data.from_email ||
    data.email_from ||
    data.reply_from ||
    DEFAULT_FROM_EMAIL;

  const fromName =
    data.sendgrid_from_name ||
    data.from_name ||
    data.brand_name ||
    data.business_name ||
    data.company_name ||
    DEFAULT_FROM_NAME;

  return {
    fromEmail,
    fromName,
    brandDebug: {
      used: "accounts",
      account_id: data.id,
      matched_user_id: data.user_id,
      picked: { fromEmail, fromName },
    },
  };
}

function findNode(nodes, id) {
  return (nodes || []).find((n) => String(n?.id) === String(id)) || null;
}

function outgoingEdges(edges, fromId) {
  return (edges || []).filter((e) => String(e?.source) === String(fromId));
}

// For normal nodes we just follow the first edge
function firstTarget(edges, fromId) {
  const e = outgoingEdges(edges, fromId)[0];
  return e?.target || null;
}

// For condition nodes, we support yes/no handles:
// Condition edges store sourceHandle: "yes" or "no"
function conditionTarget(edges, fromId, branch /* 'yes'|'no' */) {
  const outs = outgoingEdges(edges, fromId);
  const hit = outs.find((e) => String(e?.sourceHandle || "") === branch);
  if (hit?.target) return hit.target;
  return outs[0]?.target || null;
}

function delayMinutes(node) {
  const d = node?.data || {};

  // supports your schema:
  // node.data.delay = { amount, unit, ... }
  // OR node.data.minutes / delay_minutes / delayMinutes
  const delayObj = d.delay && typeof d.delay === "object" ? d.delay : null;

  const amount =
    (delayObj?.amount ?? d.minutes ?? d.delay_minutes ?? d.delayMinutes ?? d.value ?? d.amount ?? 0);

  const unit = String(delayObj?.unit ?? d.unit ?? "minutes").toLowerCase();

  let mins = Number(amount);
  if (!isFinite(mins) || mins < 0) mins = 0;

  if (unit.startsWith("day")) mins = mins * 24 * 60;
  else if (unit.startsWith("hour")) mins = mins * 60;
  else mins = mins; // minutes

  return Math.round(mins);
}

async function markJob(job_id, patch) {
  const update = { ...patch, updated_at: nowIso() };

  // Only write known columns (your automation_queue has no "error" column)
  const allowed = {};
  for (const k of [
    "status",
    "run_at",
    "next_node_id",
    "lead_id",
    "list_id",
    "contact_id",
    "subscriber_id",
  ]) {
    if (k in update) allowed[k] = update[k];
  }
  allowed.updated_at = update.updated_at;

  const { error } = await supabaseAdmin
    .from("automation_queue")
    .update(allowed)
    .eq("id", job_id);

  if (error) throw new Error(error.message);
}

function isDuplicateErr(err) {
  const msg = String(err?.message || err || "");
  const code = String(err?.code || "");
  // Postgres unique violation code
  if (code === "23505") return true;
  return msg.toLowerCase().includes("duplicate key value violates unique constraint");
}

async function enqueueNext({ job, next_node_id, run_at_iso }) {
  if (!next_node_id) return { ok: true, skipped: true, reason: "no next_node_id" };

  const row = {
    user_id: job.user_id,
    subscriber_id: job.subscriber_id || null,
    flow_id: job.flow_id,
    lead_id: job.lead_id || null,
    list_id: job.list_id || null,
    contact_id: job.contact_id || null,
    next_node_id,
    run_at: run_at_iso || nowIso(),
    status: "pending",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  // First: try to detect existing (best-effort)
  try {
    const { data: existing } = await supabaseAdmin
      .from("automation_queue")
      .select("id")
      .eq("flow_id", row.flow_id)
      .eq("lead_id", row.lead_id)
      .eq("next_node_id", row.next_node_id)
      .eq("status", "pending")
      .maybeSingle();

    if (existing?.id) return { ok: true, deduped: true, existing_id: existing.id };
  } catch {
    // ignore and attempt insert
  }

  // Insert (and IMPORTANTLY, tolerate UNIQUE duplicates)
  const { error } = await supabaseAdmin.from("automation_queue").insert([row]);
  if (!error) return { ok: true, inserted: true };

  // ✅ CRITICAL FIX: If unique constraint blocks duplicate, treat as OK (idempotent)
  if (isDuplicateErr(error)) {
    return { ok: true, deduped: true, reason: "unique constraint duplicate tolerated" };
  }

  throw new Error(error.message);
}

async function sendEmailSendGrid({ lead, node, fromEmail, fromName }) {
  if (!SENDGRID_KEY) throw new Error("Missing SENDGRID_API_KEY / GR8_MAIL_SEND_ONLY");
  if (!lead?.email) throw new Error("Lead has no email");

  const d = node?.data || {};

  // Your node uses emailId/emailName; treat emailId as template key/id
  const templateId =
    d.sendgrid_template_id ||
    d.template_id ||
    d.email_template_id ||
    d.templateId ||
    null;

  const subject = d.subject || d.title || d.label || "Hello";
  const html = d.html || d.emailHtml || null;

  const payload = templateId
    ? {
        personalizations: [
          {
            to: [{ email: lead.email, name: lead.name || undefined }],
            dynamic_template_data: {
              lead_name: lead.name || "",
              lead_email: lead.email || "",
              lead_phone: lead.phone || "",
              ...(d.dynamic_template_data || {}),
            },
          },
        ],
        from: { email: fromEmail, name: fromName },
        template_id: templateId,
      }
    : {
        personalizations: [
          { to: [{ email: lead.email, name: lead.name || undefined }] },
        ],
        from: { email: fromEmail, name: fromName },
        subject,
        content: [{ type: "text/html", value: html || `<p>${subject}</p>` }],
      };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const status = resp.status;
  const text = await resp.text().catch(() => "");

  if (status !== 202) {
    throw new Error(`SendGrid rejected (${status}): ${text.slice(0, 800)}`);
  }

  const sgMessageId = resp.headers.get("x-message-id") || null;
  return { ok: true, status, sgMessageId };
}

async function loadLead(job) {
  if (!isUuid(job.lead_id)) {
    throw new Error(`lead_id is not a uuid: "${String(job.lead_id || "")}"`);
  }

  const { data: lead, error } = await supabaseAdmin
    .from("leads")
    .select("id,email,name,phone")
    .eq("id", job.lead_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!lead?.id) throw new Error("Lead not found");

  return lead;
}

// If a job has next_node_id = null, derive the first node by:
// find a trigger node, then follow its first outgoing edge
function deriveStartNodeId(flow) {
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];

  const trigger =
    nodes.find((n) => String(n?.type || "").toLowerCase() === "trigger") || null;

  if (!trigger) return null;

  return firstTarget(edges, trigger.id);
}

async function processOneJob(job) {
  // lock it
  await markJob(job.id, { status: "running" });

  const flowLoaded = await loadFlow(job.flow_id);
  if (!flowLoaded.ok) {
    await markJob(job.id, { status: "failed" });
    return { job_id: job.id, ok: false, step: "loadFlow", error: flowLoaded.error };
  }

  const flow = flowLoaded.flow;

  // Ensure we have a node to run
  let currentNodeId = job.next_node_id;
  if (!currentNodeId) {
    currentNodeId = deriveStartNodeId(flow);
    if (currentNodeId) {
      // Persist it so it’s consistent
      await markJob(job.id, { next_node_id: currentNodeId });
    }
  }

  const node = currentNodeId ? findNode(flow.nodes, currentNodeId) : null;
  if (!node) {
    await markJob(job.id, { status: "failed" });
    return { job_id: job.id, ok: false, step: "findNode", error: "Node not found (or no next_node_id)" };
  }

  const nodeType = String(node.type || "").toLowerCase();

  // resolve next target(s)
  const nextDefault = firstTarget(flow.edges, node.id);

  if (nodeType === "delay") {
    const mins = delayMinutes(node);
    const runAt = new Date(Date.now() + mins * 60 * 1000).toISOString();

    // mark this job done
    await markJob(job.id, { status: "done" });

    // enqueue next (tolerates duplicates)
    const enq = await enqueueNext({ job, next_node_id: nextDefault, run_at_iso: runAt });

    return {
      job_id: job.id,
      ok: true,
      type: "delay",
      minutes: mins,
      next: nextDefault,
      run_at: runAt,
      enqueue: enq,
    };
  }

  if (nodeType === "condition") {
    // default to "no" branch until tracking exists
    const nextNo = conditionTarget(flow.edges, node.id, "no");

    await markJob(job.id, { status: "done" });
    const enq = await enqueueNext({ job, next_node_id: nextNo, run_at_iso: nowIso() });

    return {
      job_id: job.id,
      ok: true,
      type: "condition",
      evaluated: "no (default)",
      next: nextNo,
      enqueue: enq,
    };
  }

  if (nodeType === "email") {
    try {
      const lead = await loadLead(job);
      const brand = await loadAccountBrandByAuthUser(job.user_id);

      const sent = await sendEmailSendGrid({
        lead,
        node,
        fromEmail: brand.fromEmail,
        fromName: brand.fromName,
      });

      // mark current job done FIRST (so it won’t re-run)
      await markJob(job.id, { status: "done" });

      // enqueue next (tolerates duplicates)
      const enq = await enqueueNext({
        job,
        next_node_id: nextDefault,
        run_at_iso: nowIso(),
      });

      return {
        job_id: job.id,
        ok: true,
        type: "email",
        node_id: node.id,
        next: nextDefault,
        to: lead.email,
        from: { email: brand.fromEmail, name: brand.fromName },
        sendgrid: sent,
        enqueue: enq,
        brandDebug: brand.brandDebug,
      };
    } catch (e) {
      // If the *only* error is a duplicate enqueue, we should NOT fail the email step.
      // However, duplicate enqueue is already tolerated inside enqueueNext.
      await markJob(job.id, { status: "failed" });
      return {
        job_id: job.id,
        ok: false,
        step: "sendEmail",
        node_id: node.id,
        derived_next_node_id: nextDefault || null,
        error: String(e?.message || e).slice(0, 800),
      };
    }
  }

  // Trigger or unknown types: just pass through
  await markJob(job.id, { status: "done" });
  const enq = await enqueueNext({ job, next_node_id: nextDefault, run_at_iso: nowIso() });

  return { job_id: job.id, ok: true, type: nodeType || "unknown", next: nextDefault, enqueue: enq };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Use GET or POST" });
  }

  try {
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const now = nowIso();

    const { data: jobs, error } = await supabaseAdmin
      .from("automation_queue")
      .select("*")
      .eq("status", "pending")
      .lte("run_at", now)
      .order("run_at", { ascending: true })
      .limit(limit);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    const results = [];
    let locked = 0;

    for (const job of jobs || []) {
      locked += 1;
      try {
        const out = await processOneJob(job);
        results.push(out);
      } catch (e) {
        try {
          await markJob(job.id, { status: "failed" });
        } catch {}
        results.push({
          job_id: job.id,
          ok: false,
          step: "exception",
          error: String(e?.message || e).slice(0, 800),
        });
      }
    }

    return res.json({
      ok: true,
      now,
      select_debug: {
        selected_pending_due: jobs?.length || 0,
        locked,
        limit,
      },
      results,
      env: {
        hasSendGridKey: !!SENDGRID_KEY,
        defaultFromEmail: DEFAULT_FROM_EMAIL,
        defaultFromName: DEFAULT_FROM_NAME,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
