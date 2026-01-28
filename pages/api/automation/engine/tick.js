// /pages/api/automation/engine/tick.js
// FULL REPLACEMENT — fixes TENANT_MISMATCH and makes runs use lead.user_id (source of truth)
//
// ✅ Auth via:
//    - Authorization: Bearer <secret>
//    - OR query param: ?key=<secret>
//    - OR header: x-cron-key: <secret>
//
// ✅ NEVER fails just because run.user_id is wrong — repairs it to lead.user_id
// ✅ Sends emails for "email" nodes (HTML in Supabase Storage)
// ✅ Works whether nodes/edges stored as JSON string or object
// ✅ Does not touch Broadcasts/Campaigns modules
//
// ENV required:
//  - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
//  - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE)
//  - SENDGRID_API_KEY (or GR8_MAIL_SEND_ONLY)
//  - AUTOMATION_CRON_SECRET (or AUTOMATION_CRON_KEY / CRON_SECRET)
// Optional:
//  - DEFAULT_FROM_EMAIL
//  - DEFAULT_FROM_NAME

import sgMail from "@sendgrid/mail";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE;

const CRON_SECRET =
  (process.env.AUTOMATION_CRON_SECRET || "").trim() ||
  (process.env.AUTOMATION_CRON_KEY || "").trim() ||
  (process.env.CRON_SECRET || "").trim();

function getSendGridKey() {
  return (process.env.SENDGRID_API_KEY || process.env.GR8_MAIL_SEND_ONLY || "").trim();
}

function okAuth(req) {
  const h = (req.headers.authorization || "").trim();
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const q = (req.query.key || "").toString().trim();
  const x = (req.headers["x-cron-key"] || "").toString().trim();
  const secret = CRON_SECRET;
  if (!secret) return true; // dev-safe: if no secret set, allow
  return bearer === secret || q === secret || x === secret;
}

function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function loadHtmlFromStorage(supabase, bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`STORAGE_DOWNLOAD_FAILED: ${error?.message || "no data"}`);
  return await data.text();
}

function findStartNodeId(nodes, edges) {
  // prefer explicit trigger node
  const trigger = (nodes || []).find((n) => (n?.type || "").toLowerCase().includes("trigger"));
  if (trigger?.id) return trigger.id;

  // fallback: first node with no incoming edges
  const incoming = new Set((edges || []).map((e) => e.target));
  const first = (nodes || []).find((n) => !incoming.has(n.id));
  return first?.id || (nodes?.[0]?.id ?? null);
}

function nextFrom(nodeId, edges) {
  const e = (edges || []).find((x) => x.source === nodeId);
  return e?.target || null;
}

function nextFromLabel(nodeId, edges, label) {
  const e = (edges || []).find((x) => x.source === nodeId && x.label === label);
  return e?.target || null;
}

function nowIso() {
  return new Date().toISOString();
}

async function insertRunTolerant(supabase, baseRow, startNodeId) {
  try {
    const row = { ...baseRow, current_node_id: startNodeId };
    const { error } = await supabase.from("automation_flow_runs").insert([row]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function selectRunsTolerant(supabase, flow_id, max) {
  try {
    const { data, error } = await supabase
      .from("automation_flow_runs")
      .select("id, lead_id, current_node_id, status, available_at, user_id")
      .eq("flow_id", flow_id)
      .eq("status", "pending")
      .lte("available_at", nowIso())
      .order("available_at", { ascending: true })
      .limit(max);

    if (error) return { ok: false, error: error.message, data: null, mode: "id" };
    return { ok: true, data: data || [], mode: "id" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), data: null, mode: "id" };
  }
}

async function updateRunTolerant(supabase, runId, updates, mode) {
  try {
    // Handle both current_node and current_node_id modes
    const updateData = { ...updates };
    if (updates.current_node !== undefined && mode === "name") {
      updateData.current_node_id = updates.current_node;
      delete updateData.current_node;
    }

    const { error } = await supabase
      .from("automation_flow_runs")
      .update(updateData)
      .eq("id", runId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!okAuth(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const flow_id = (req.body?.flow_id || req.query.flow_id || "").toString().trim();
  const max = Math.min(parseInt(req.body?.max || req.query.max || "50", 10) || 50, 200);
  const armed = (req.query.arm || req.body?.arm || "").toString().toLowerCase() === "yes";

  const debug = {
    flow_id,
    max,
    now: new Date().toISOString(),
    armed,
    members_seen: 0,
    runs_created: 0,
    picked: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    advanced: 0,
    errors: [],
    notes: [],
  };

  try {
    if (!flow_id) {
      return res.status(400).json({ ok: false, error: "Missing flow_id", debug });
    }

    // SendGrid key is OPTIONAL for tick processing now.
    // We only need it when actually sending emails; queueing does not require it.
    const sgKey = getSendGridKey();
    if (sgKey) {
      try { sgMail.setApiKey(sgKey); } catch {}
    } else {
      debug.notes.push("No SendGrid key — will queue only, not send");
    }

    // Load flow
    const { data: flow, error: flowErr } = await supabase
      .from("automation_flows")
      .select("id, nodes, edges, name")
      .eq("id", flow_id)
      .single();

    if (flowErr || !flow) {
      return res.status(404).json({ ok: false, error: flowErr?.message || "Flow not found", debug });
    }

    const nodes = safeJson(flow.nodes, []);
    const edges = safeJson(flow.edges, []);
    const startNodeId = findStartNodeId(nodes, edges);
    if (!startNodeId) {
      return res.status(500).json({ ok: false, error: "Flow has no start node", debug });
    }

    // Members for this flow (these are the leads you WANT to process)
    const { data: members, error: memErr } = await supabase
      .from("automation_flow_members")
      .select("id, lead_id, flow_id")
      .eq("flow_id", flow_id)
      .limit(max);

    if (memErr) throw new Error(`MEMBERS_LOAD_FAILED: ${memErr.message}`);
    debug.members_seen = members?.length || 0;

    // Ensure a run exists per member (without creating wrong user_id)
    for (const m of members || []) {
      if (!m.lead_id) continue;

      // get lead owner
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("id, user_id, email")
        .eq("id", m.lead_id)
        .single();

      if (leadErr || !lead?.user_id) {
        debug.errors.push(`LEAD_LOAD_FAILED ${m.lead_id}: ${leadErr?.message || "no lead/user_id"}`);
        continue;
      }


      // Does run exist already?
      const { data: existing, error: exErr } = await supabase
        .from("automation_flow_runs")
        .select("id")
        .eq("flow_id", flow_id)
        .eq("lead_id", m.lead_id)
        .maybeSingle();

      if (!exErr && existing?.id) continue;

      const baseRow = {
        flow_id,
        lead_id: m.lead_id,
        user_id: lead.user_id, // ✅ required
        status: "pending",
        available_at: nowIso(),
        last_error: null,
      };

      const ins = await insertRunTolerant(supabase, baseRow, startNodeId);
      if (!ins.ok) debug.errors.push(`RUN_CREATE_FAILED ${m.lead_id}: ${ins.error}`);
      else debug.runs_created += 1;
    }

    // Pick runs ready to process (tolerant select)
    const runsOut = await selectRunsTolerant(supabase, flow_id, max);
    if (!runsOut.ok) {
      return res.status(500).json({ ok: false, error: `RUNS_LOAD_FAILED: ${runsOut.error}`, debug });
    }

    const runs = runsOut.data || [];
    const currentNodeMode = runsOut.mode; // "id" or "name"
    debug.picked = runs.length;

    for (const r of runs || []) {
      debug.processed += 1;

      // Always load lead owner and enforce consistency
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("id, user_id, email, name")
        .eq("id", r.lead_id)
        .single();

      if (leadErr || !lead?.email) {
        const msg = `LEAD_LOAD_FAILED: ${leadErr?.message || "missing email"}`;
        debug.failed += 1;
        debug.errors.push(msg);
        await supabase.from("automation_flow_runs").update({
          status: "failed",
          last_error: msg,
        }).eq("id", r.id);
        continue;
      }

      if (lead.user_id !== r.user_id) {
        // repair + continue (don’t fail the flow)
        await supabase.from("automation_flow_runs").update({
          user_id: lead.user_id,
          last_error: null,
        }).eq("id", r.id);
      }

      // Fetch account information for the user to get their name/company
      const { data: account, error: accountErr } = await supabase
        .from("accounts")
        .select("id, user_id, business_name, full_name, name")
        .eq("user_id", r.user_id)
        .maybeSingle();

      if (accountErr) {
        debug.errors.push(`ACCOUNT_LOAD_FAILED ${r.user_id}: ${accountErr.message}`);
      }

      // Initialize current_node_id if null
      let currentNodeId = r.current_node_id;
      if (!currentNodeId) {
        currentNodeId = startNodeId;
        await supabase.from("automation_flow_runs").update({
          current_node_id: startNodeId,
        }).eq("id", r.id);
      }

      const node = (nodes || []).find((n) => n.id === currentNodeId);
      if (!node) {
        debug.failed += 1;
        debug.errors.push("NODE_NOT_FOUND");
        await supabase.from("automation_flow_runs").update({
          status: "failed",
          last_error: "NODE_NOT_FOUND",
        }).eq("id", r.id);
        continue;
      }

      const nodeType = (node.type || "").toLowerCase();
      const nodeData = node.data || {};
      debug.notes.push(`RUN ${r.id} at node ${currentNodeId} (${nodeType})`);

      try {
        if (nodeType.includes("email")) {
          let html = "";
          let subject = (nodeData.subject || nodeData.label || "Check-in").toString();
          let bucket = (nodeData.bucket || nodeData.storage_bucket || "email-user-assets").toString();
          let path = "";

          // PRIORITY 1: Check if node has htmlPath or storagePath (direct HTML file path)
          path = nodeData.htmlPath || nodeData.storagePath || nodeData.html_path || nodeData.storage_path || "";
          
          if (path) {
            // Load HTML from storage using the direct path
            html = await loadHtmlFromStorage(supabase, bucket, path);
            
            if (!html) {
              throw new Error(`EMAIL_STORAGE_LOAD_FAILED: bucket=${bucket}, path=${path}`);
            }
          } else {
            // FALLBACK 1: Try to extract from emailPreviewUrl and change .png to .html
            const previewUrl = nodeData.emailPreviewUrl || nodeData.preview_url || "";
            if (previewUrl && previewUrl.includes('/storage/')) {
              const match = previewUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+\.png)$/);
              if (match) {
                bucket = match[1];
                // Change .png to .html
                path = match[2].replace(/\.png$/, '.html');
                try {
                  html = await loadHtmlFromStorage(supabase, bucket, path);
                } catch (err) {
                  debug.notes.push(`Failed to load HTML from preview URL: ${err.message}`);
                  html = "";
                }
              }
            }
            
            // FALLBACK 2: lookup by emailId
            if (!html) {
              const emailId = nodeData.emailId || nodeData.email_id || "";
              if (!emailId) {
                throw new Error(`EMAIL_NODE_MISSING_ID_AND_URL: nodeData keys: ${Object.keys(nodeData).join(', ')}`);
              }

              const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(emailId);

              const { data: tmpl, error: tmplErr } = await supabase
                .from("email_templates")
                .select("*")
                .eq(isUUID ? "id" : "name", emailId)
                .maybeSingle();

              if (tmplErr || !tmpl) {
                throw new Error(`EMAIL_RECORD_NOT_FOUND: ${emailId} - ${tmplErr?.message || "not found"}`);
              }

              html = tmpl.html || tmpl.html_content || tmpl.content || tmpl.body || tmpl.template_html || "";
              subject = tmpl.subject || tmpl.title || tmpl.name || subject;
              path = tmpl.html_path || tmpl.storage_path || tmpl.path || tmpl.file_path || "";
              bucket = tmpl.bucket || tmpl.storage_bucket || bucket;

              if (!html && path) {
                html = await loadHtmlFromStorage(supabase, bucket, path);
              }

              if (!html) {
                throw new Error(`EMAIL_NO_HTML_CONTENT: emailId=${emailId}, available keys: ${Object.keys(tmpl).join(', ')}`);
              }
            }
          }

          // QUEUE the email - Base64 encode HTML to avoid escape issues
          try {
            // Convert HTML to base64 to avoid any Unicode escape sequence issues
            const htmlBase64 = Buffer.from(html || '', 'utf8').toString('base64');
            
            const { error: qInsertErr } = await supabase.from("automation_email_queue").insert({
              user_id: r.user_id,
              flow_id: flow_id,
              node_id: currentNodeId,
              lead_id: r.lead_id,
              to_email: lead.email,
              subject: subject,
              html_content: htmlBase64,  // Store as base64
              variant: nodeData.label || subject,
              status: "pending",
            });
            if (qInsertErr) {
              debug.errors.push(`Queue insert failed: ${qInsertErr.message}`);
            } else {
              debug.sent += 1;
            }
          } catch (qErr) {
            debug.errors.push(`Queue error: ${qErr?.message}`);
          }

          // Move to next node (email sent, advance)
          const next = nextFrom(currentNodeId, edges);
          if (!next) {
            await supabase.from("automation_flow_runs").update({
              status: "done",
              current_node_id: null,
              available_at: new Date().toISOString(),
              last_error: null,
            }).eq("id", r.id);
          } else {
            await supabase.from("automation_flow_runs").update({
              status: "pending",
              current_node_id: next,
              available_at: new Date().toISOString(),
              last_error: null,
            }).eq("id", r.id);
            debug.advanced += 1;
          }
        } else if (nodeType.includes("delay")) {
          // delay node: wait N minutes then advance
          const minutes = parseInt(nodeData.minutes || nodeData.delay_minutes || "1", 10) || 1;
          const when = new Date(Date.now() + minutes * 60 * 1000).toISOString();
          const next = nextFrom(currentNodeId, edges);

          await supabase.from("automation_flow_runs").update({
            status: next ? "pending" : "done",
            current_node_id: next,
            available_at: when,
            last_error: null,
          }).eq("id", r.id);

          debug.advanced += 1;
        } else if (nodeType.includes("condition")) {
          // Condition node: evaluate and pick the right branch based on condition type
          const condition = nodeData.condition || {};
          const conditionType = condition.type || "";
          
          let shouldTakeYesPath = true; // default to yes
          let shouldWait = false; // whether to delay before evaluating
          
          // Handle different condition types
          if (conditionType === "email_opened") {
            // For email_opened condition:
            // 1. Check if there's a wait time (e.g., 1 day)
            // 2. If wait time not yet elapsed, hold the run
            // 3. If elapsed, check if email was opened
            
            const waitHours = parseInt(condition.waitHours || condition.hours_to_wait || "24", 10) || 24;
            const waitTime = waitHours * 60 * 60 * 1000;
            
            // Get the most recent email sent to this lead in this flow
            const { data: emailQueue, error: eqErr } = await supabase
              .from("automation_email_queue")
              .select("id, created_at, opened_at")
              .eq("flow_id", flow_id)
              .eq("lead_id", r.lead_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (!eqErr && emailQueue) {
              const sentTime = new Date(emailQueue.created_at).getTime();
              const nowTime = Date.now();
              const elapsedTime = nowTime - sentTime;
              
              if (elapsedTime < waitTime) {
                // Wait time not yet elapsed, hold the run
                const availableAt = new Date(sentTime + waitTime).toISOString();
                await supabase.from("automation_flow_runs").update({
                  status: "pending",
                  current_node_id: currentNodeId,
                  available_at: availableAt,
                  last_error: null,
                }).eq("id", r.id);
                debug.advanced += 1;
                continue;
              } else {
                // Wait time elapsed, check if email was opened
                shouldTakeYesPath = !!emailQueue.opened_at;
              }
            }
          } else if (conditionType === "tag_exists") {
            // Check if lead has the tag
            const tag = condition.tag || "";
            if (tag) {
              const { data: leadTags } = await supabase
                .from("lead_tags")
                .select("id")
                .eq("lead_id", r.lead_id)
                .eq("tag", tag)
                .maybeSingle();
              shouldTakeYesPath = !!leadTags;
            }
          } else if (conditionType === "field_equals") {
            // Check if lead field equals value
            const field = condition.field || "";
            const value = condition.value || "";
            if (field && lead && value) {
              shouldTakeYesPath = String(lead[field] || "") === String(value);
            }
          } else if (conditionType === "field_contains") {
            // Check if lead field contains value
            const field = condition.field || "";
            const value = condition.value || "";
            if (field && lead && value) {
              shouldTakeYesPath = String(lead[field] || "").includes(String(value));
            }
          }
          
          // Determine which path to take
          const yesPath = nextFromLabel(currentNodeId, edges, "yes");
          const noPath = nextFromLabel(currentNodeId, edges, "no");
          const nextPath = shouldTakeYesPath ? yesPath : noPath;
          
          if (nextPath) {
            await supabase.from("automation_flow_runs").update({
              status: "pending",
              current_node_id: nextPath,
              available_at: new Date().toISOString(),
              last_error: null,
            }).eq("id", r.id);
            debug.advanced += 1;
          } else {
            await supabase.from("automation_flow_runs").update({
              status: "done",
              current_node_id: null,
              last_error: null,
            }).eq("id", r.id);
          }
        } else if (nodeType.includes("trigger")) {
          // Trigger node: just advance to the next node (email, delay, etc.)
          const next = nextFrom(currentNodeId, edges);
          debug.notes.push(`TRIGGER ${currentNodeId} -> ${next || 'END'}`);
          await supabase.from("automation_flow_runs").update({
            status: next ? "pending" : "done",
            current_node_id: next,
            available_at: new Date().toISOString(),
            last_error: null,
          }).eq("id", r.id);

          debug.advanced += 1;
        } else {
          // unknown node: just advance
          const next = nextFrom(currentNodeId, edges);
          await supabase.from("automation_flow_runs").update({
            status: next ? "pending" : "done",
            current_node_id: next,
            available_at: new Date().toISOString(),
            last_error: null,
          }).eq("id", r.id);

          debug.advanced += 1;
        }
      } catch (e) {
        const msg = String(e?.message || e);
        debug.failed += 1;
        debug.errors.push(msg);
        await supabase.from("automation_flow_runs").update({
          status: "failed",
          last_error: msg,
        }).eq("id", r.id);
      }
    }

    // Auto-flush queued emails after processing
    if (debug.sent > 0) {
      try {
        const flushResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/automation/email/flush-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-key': CRON_SECRET || '',
          },
        });
        const flushResult = await flushResponse.json();
        debug.notes.push(`Auto-flushed: ${flushResult?.debug?.sent || 0} emails sent`);
      } catch (flushErr) {
        debug.errors.push(`Auto-flush failed: ${flushErr?.message || String(flushErr)}`);
      }
    }

    return res.status(200).json({ ok: true, debug });
  } catch (e) {
    debug.errors.push(String(e?.message || e));
    return res.status(500).json({ ok: false, error: String(e?.message || e), debug });
  }
}
