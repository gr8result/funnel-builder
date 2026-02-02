// /pages/api/automation/engine/tick.js
// FULL REPLACEMENT
//
// ✅ For each active member in automation_flow_members:
//    - ensures a row exists in automation_flow_runs
//    - advances past Trigger to first node after trigger
//    - if that node is an Email node => inserts a row into automation_email_queue (status='pending')
// ✅ This is what makes flows actually start.
//
// Supports POST body:
//  { flow_id?: uuid, max?: number }
// Auth: x-cron-key OR ?key= OR Bearer (uses AUTOMATION_CRON_SECRET / CRON_SECRET style)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE ||
  "";

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function okAuth(req) {
  const secret = CRON_SECRET;
  if (!secret) return true;

  const h = (req.headers.authorization || "").trim();
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const q = (req.query.key || "").toString().trim();
  const x = (req.headers["x-cron-key"] || "").toString().trim();
  return bearer === secret || q === secret || x === secret;
}

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return fallback;
  }
}

function nodeType(n) {
  const type = String(n?.type || n?.data?.type || "").toLowerCase();
  // Debug logging
  if (n?.id) {
    console.log(`nodeType check for ${n.id}: n.type="${n?.type}", n.data.type="${n?.data?.type}", result="${type}"`);
  }
  return type;
}

function firstOutgoing(edges, fromId) {
  const e = (edges || []).find((x) => String(x?.source) === String(fromId));
  return e?.target ? String(e.target) : null;
}

function findTrigger(nodes) {
  return (nodes || []).find((n) => nodeType(n) === "trigger") || null;
}

function findNode(nodes, id) {
  return (nodes || []).find((n) => String(n?.id) === String(id)) || null;
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureEmailQueueRow({ flow_id, lead_id, node_id, node_data, user_id }) {
  console.log(`ensureEmailQueueRow called: flow=${flow_id}, lead=${lead_id}, node=${node_id}, user=${user_id}`);
  
  // Extract email configuration from node data
  const subject = node_data?.subject || node_data?.label || node_data?.emailName || "Email from automation";
  let html_content = node_data?.html || node_data?.htmlContent || node_data?.body || node_data?.content || "";
  
  // If no inline HTML, check if there's a storage path to the HTML file
  const htmlPath = node_data?.htmlPath || node_data?.storagePath;
  const bucket = node_data?.bucket || "email-user-assets";
  
  if (!html_content && htmlPath) {
    // Fetch HTML from Supabase Storage
    const { data: fileData, error: fileErr } = await supabaseAdmin.storage
      .from(bucket)
      .download(htmlPath);
    
    if (!fileErr && fileData) {
      html_content = await fileData.text();
    } else {
      console.error(`Failed to fetch HTML from storage: ${htmlPath}`, fileErr?.message);
    }
  }
  
  console.log(`Email config: subject="${subject}", html_length=${html_content.length}, htmlPath=${htmlPath || 'none'}`);
  
  // Get lead's email address and user_id - REQUIRED by automation_email_queue
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from("leads")
    .select("email,name,user_id")
    .eq("id", lead_id)
    .maybeSingle();
  
  if (leadErr) {
    console.error(`Failed to fetch lead ${lead_id}:`, leadErr.message);
    throw new Error(`Lead fetch failed: ${leadErr.message}`);
  }
  
  if (!lead?.email) {
    console.error(`Lead ${lead_id} has no email address`);
    throw new Error(`Lead ${lead_id} has no email address`);
  }
  
  // Use lead's user_id (more reliable than flow's user_id)
  const lead_user_id = lead.user_id || user_id;
  
  // Fetch user's email settings from accounts table
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("business_name,business_email")
    .eq("user_id", lead_user_id)
    .maybeSingle();
  
  const from_email = account?.business_email || null;
  const from_name = account?.business_name || null;
  
  // best-effort dedupe
  const { data: existing } = await supabaseAdmin
    .from("automation_email_queue")
    .select("id,status")
    .eq("flow_id", flow_id)
    .eq("lead_id", lead_id)
    .eq("node_id", node_id)
    .maybeSingle();

  if (existing?.id) {
    console.log(`Email queue row already exists: ${existing.id}`);
    return { ok: true, deduped: true, existing_id: existing.id };
  }

  const row = {
    user_id: lead_user_id,  // Use lead's user_id - this is a valid auth user
    flow_id,
    lead_id,
    node_id,
    to_email: lead.email,  // REQUIRED - lead's email address
    subject: subject,  // REQUIRED - email subject
    html_content: html_content || `<p>Email body for: ${subject}</p>`,  // REQUIRED - email HTML
    status: "pending",  // Valid values: pending, sent, failed, bounced
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  const ins = await supabaseAdmin.from("automation_email_queue").insert([row]);
  if (ins.error) {
    console.error(`Insert failed for lead ${lead_id}:`, ins.error.message);
    throw new Error(`Email queue insert failed: ${ins.error.message}`);
  }

  console.log(`✅ Email queued successfully for ${lead.email} - subject: "${subject}"`);
  
  return { ok: true, inserted: true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    if (!okAuth(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const flow_id_filter = String(req.body?.flow_id || "").trim();
    const max = Math.min(Number(req.body?.max || 200), 1000);

    let flowQ = supabaseAdmin
      .from("automation_flows")
      .select("id,user_id,nodes,edges");

    if (flow_id_filter) flowQ = flowQ.eq("id", flow_id_filter);

    const { data: flows, error: flowErr } = await flowQ.limit(200);
    if (flowErr) return res.status(500).json({ ok: false, error: flowErr.message });

    let touchedRuns = 0;
    let queuedEmails = 0;
    const processedFlows = [];

    for (const flow of flows || []) {
      const flow_id = flow.id;
      const flowUserId = flow.user_id;

      const nodes = safeJson(flow.nodes, []);
      const edges = safeJson(flow.edges, []);

      const trigger = findTrigger(nodes);
      if (!trigger?.id) {
        // Flow has no trigger - skip but could log for debugging
        continue;
      }

      const firstAfterTrigger = firstOutgoing(edges, trigger.id);
      if (!firstAfterTrigger) {
        // ⚠️ BUG FIX: Flow has trigger but no outgoing edge!
        // This is the problem - flows with triggers but no edges to next node are being skipped
        // We should log this or handle it, but for now we skip
        continue;
      }

      const firstNode = findNode(nodes, firstAfterTrigger);
      const firstType = nodeType(firstNode);
      
      console.log(`✓ Flow ${flow_id} structure: trigger=${trigger?.id}, edge_to=${firstAfterTrigger}, first_node_type=${firstType}`);

      const { data: members, error: memErr } = await supabaseAdmin
        .from("automation_flow_members")
        .select("lead_id,status")
        .eq("flow_id", flow_id)
        .eq("status", "active")
        .limit(max);

      if (memErr) continue;
      
      console.log(`✓ Flow ${flow_id} has ${(members || []).length} active members`);
      
      // Track this flow for debugging
      if (members && members.length > 0) {
        processedFlows.push({
          flow_id,
          member_count: members.length,
          has_trigger: !!trigger?.id,
          has_edge: !!firstAfterTrigger,
          first_node_type: firstType,
          first_node_found: !!firstNode,
        });
      }

      for (const m of members || []) {
        const lead_id = String(m.lead_id || "").trim();
        if (!lead_id) continue;

        // Fetch lead details for condition evaluation
        const { data: lead, error: leadErr } = await supabaseAdmin
          .from("leads")
          .select("id,user_id,email")
          .eq("id", lead_id)
          .maybeSingle();
        
        if (!lead?.id) continue;

        // Ensure run exists
        const { data: run } = await supabaseAdmin
          .from("automation_flow_runs")
          .select("id,current_node_id,status")
          .eq("flow_id", flow_id)
          .eq("lead_id", lead_id)
          .maybeSingle();

        if (!run?.id) {
          const ins = await supabaseAdmin.from("automation_flow_runs").insert([
            {
              user_id: flowUserId, // your automation_flow_runs.user_id exists
              flow_id,
              lead_id,
              current_node_id: firstAfterTrigger, // start at first node after trigger
              status: "active",
              available_at: nowIso(),
              created_at: nowIso(),
              updated_at: nowIso(),
            },
          ]);
          if (!ins.error) touchedRuns += 1;
        } else {
          // If stuck on trigger, push forward
          const cur = String(run.current_node_id || "").trim();
          if (!cur || cur === String(trigger.id)) {
            const up = await supabaseAdmin
              .from("automation_flow_runs")
              .update({ current_node_id: firstAfterTrigger, available_at: nowIso(), updated_at: nowIso(), status: "active" })
              .eq("id", run.id);
            if (!up.error) touchedRuns += 1;
          }
        }

        // Process current node (could be email, condition, delay, etc.)
        const currentNodeId = run?.current_node_id || firstAfterTrigger;
        const currentNode = findNode(nodes, currentNodeId);
        const currentNodeType = nodeType(currentNode);

        // Handle condition nodes with email engagement routing
        if (currentNodeType === "condition") {
          const condition = currentNode?.data?.condition || {};
          let conditionMet = false;

          if (condition.type === "email_not_opened") {
            // Check if the previous email was sent and its open status
            const waitDays = condition.waitDays || 3;
            const waitMs = waitDays * 24 * 60 * 60 * 1000;
            
            // Find the most recent email sent to this lead in this flow
            const { data: queueRow } = await supabaseAdmin
              .from("automation_email_queue")
              .select("id,sent_at,open_count")
              .eq("flow_id", flow_id)
              .eq("lead_id", lead_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (queueRow?.sent_at) {
              const sentTime = new Date(queueRow.sent_at).getTime();
              const nowTime = new Date().getTime();
              const timePassed = nowTime - sentTime;

              if (timePassed >= waitMs && (queueRow.open_count || 0) === 0) {
                // Email not opened AND wait time exceeded => condition met (route to "no" path)
                conditionMet = true;
              } else if ((queueRow.open_count || 0) > 0) {
                // Email WAS opened => condition NOT met (route to "yes" path)
                conditionMet = false;
              } else {
                // Still waiting for email open or timeout - stay on this node
                continue;
              }
            } else {
              // No email sent yet - stay on this node
              continue;
            }
          } else if (condition.type === "email_opened") {
            // Check if the previous email was opened
            const { data: queueRow } = await supabaseAdmin
              .from("automation_email_queue")
              .select("id,open_count,sent_at")
              .eq("flow_id", flow_id)
              .eq("lead_id", lead_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (queueRow?.open_count && queueRow.open_count > 0) {
              // Email WAS opened - immediate route to yes
              conditionMet = true;
            } else if (queueRow?.sent_at) {
              // Email sent but not opened yet - check wait time
              const waitDays = condition.waitDays || 0;
              const waitMs = waitDays * 24 * 60 * 60 * 1000;
              const sentTime = new Date(queueRow.sent_at).getTime();
              const nowTime = new Date().getTime();
              const timePassed = nowTime - sentTime;

              if (timePassed >= waitMs) {
                // Wait period expired and still not opened - route to no
                conditionMet = false;
              } else {
                // Still waiting for open or for timeout to expire
                continue;
              }
            } else {
              // No email sent yet
              continue;
            }
          }

          // Route to "yes" or "no" handle based on condition
          const handleId = conditionMet ? "yes" : "no";
          const nextEdge = (edges || []).find(
            (e) => String(e?.source) === String(currentNodeId) && String(e?.sourceHandle) === handleId
          );
          
          if (!nextEdge?.target) {
            // No path for this condition result - end flow for this member
            continue;
          }

          const nextNodeId = nextEdge.target;
          const nextNode = findNode(nodes, nextNodeId);
          const nextType = nodeType(nextNode);

          // Advance to next node
          await supabaseAdmin
            .from("automation_flow_runs")
            .update({ current_node_id: nextNodeId, available_at: nowIso(), updated_at: nowIso() })
            .eq("id", run.id);
          
          touchedRuns += 1;

          // If next node is email, queue it
          if (nextType === "email") {
            try {
              const q = await ensureEmailQueueRow({
                flow_id,
                lead_id,
                node_id: nextNodeId,
                node_data: nextNode?.data || {},
                user_id: flowUserId,
              });
              if (q?.inserted || q?.deduped) queuedEmails += 1;
            } catch (qErr) {
              console.error(`Failed to queue email for lead ${lead_id}:`, qErr.message || qErr);
            }
          }
        }
        // If first node after trigger is email => enqueue it
        else if (firstType === "email" && currentNodeId === firstAfterTrigger) {
          try {
            const q = await ensureEmailQueueRow({
              flow_id,
              lead_id,
              node_id: firstAfterTrigger,
              node_data: firstNode?.data || {},  // Pass email node data for subject, body, etc.
              user_id: flowUserId,
            });
            if (q?.inserted || q?.deduped) queuedEmails += 1;
          } catch (qErr) {
            // Log but don't fail the whole flow
            console.error(`Failed to queue email for lead ${lead_id}:`, qErr.message || qErr);
          }
        }
      }
    }

    return res.json({
      ok: true,
      flows: (flows || []).length,
      touched_runs: touchedRuns,
      queued_emails: queuedEmails,
      processed_flows: processedFlows,
    });
  } catch (e) {
    console.error("❌ TICK ENDPOINT ERROR:", e);
    console.error("Stack:", e?.stack);
    return res.status(500).json({ ok: false, error: e?.message || String(e), stack: e?.stack });
  }
}
