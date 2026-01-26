// /pages/api/automation/webhook/purchase-completed.js
//
// ✅ Webhook endpoint for purchase completion events
// ✅ Accepts purchase events from payment processors (Stripe, PayPal, etc.)
// ✅ Finds automation flows with "purchase_completed" trigger
// ✅ Enrolls the customer/lead into matching flows
//
// POST body examples:
// 1) Direct format:
//    { lead_id: "uuid", email: "customer@example.com", order_id: "order_123", amount: 99.99 }
//
// 2) Stripe checkout.session.completed format:
//    { type: "checkout.session.completed", data: { object: { customer_email: "...", metadata: { lead_id: "..." } } } }
//
// How it works:
// - Extract lead_id or email from webhook payload
// - Find lead in database if only email is provided
// - Call /api/automation/engine/enroll with event="purchase_completed"
// - The enroll endpoint finds all flows with purchase_completed trigger and enrolls the lead

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing required environment variables: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = SUPABASE_URL && SERVICE_KEY 
  ? createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    })
  : null;

function extractLeadInfo(body) {
  // Direct format
  if (body.lead_id) {
    return {
      lead_id: body.lead_id,
      email: body.email || null,
      order_id: body.order_id || null,
      amount: body.amount || null,
    };
  }

  // Stripe webhook format
  if (body.type === "checkout.session.completed" && body.data?.object) {
    const session = body.data.object;
    return {
      lead_id: session.metadata?.lead_id || session.metadata?.app_contact_id || null,
      email: session.customer_email || session.customer_details?.email || null,
      order_id: session.id,
      amount: session.amount_total ? session.amount_total / 100 : null,
    };
  }

  // PayPal webhook format (example)
  if (body.event_type && body.resource) {
    const resource = body.resource;
    return {
      lead_id: resource.custom_id || null,
      email: resource.payer?.email_address || null,
      order_id: resource.id,
      amount: resource.amount?.value || null,
    };
  }

  // Generic format - look for email
  if (body.email) {
    return {
      lead_id: null,
      email: body.email,
      order_id: body.order_id || body.transaction_id || body.id || null,
      amount: body.amount || body.total || null,
    };
  }

  return null;
}

async function findLeadByEmail(email, user_id = null) {
  const query = supabase.from("leads").select("id,user_id,email");

  if (user_id) {
    query.eq("user_id", user_id);
  }

  query.eq("email", email).maybeSingle();

  const { data, error } = await query;

  if (error || !data) return null;
  return data;
}

export default async function handler(req, res) {
  const debug = {
    received_at: new Date().toISOString(),
    lead_id: null,
    email: null,
    order_id: null,
    amount: null,
    enrolled_flows: 0,
    errors: [],
  };

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error: "Server configuration error: Missing Supabase credentials",
        debug,
      });
    }

    // Extract lead info from webhook payload
    const leadInfo = extractLeadInfo(req.body || {});

    if (!leadInfo) {
      return res.status(400).json({
        ok: false,
        error: "Unable to extract lead information from webhook payload",
        hint: "Expected { lead_id } or { email } or Stripe/PayPal webhook format",
        debug,
      });
    }

    debug.lead_id = leadInfo.lead_id;
    debug.email = leadInfo.email;
    debug.order_id = leadInfo.order_id;
    debug.amount = leadInfo.amount;

    let lead_id = leadInfo.lead_id;

    // If no lead_id but we have email, try to find the lead
    if (!lead_id && leadInfo.email) {
      const lead = await findLeadByEmail(leadInfo.email);
      if (lead) {
        lead_id = lead.id;
        debug.lead_id = lead_id;
        debug.note = "Lead found by email";
      }
    }

    if (!lead_id) {
      return res.status(404).json({
        ok: false,
        error: "Lead not found",
        hint: "Provide lead_id or ensure email matches an existing lead",
        debug,
      });
    }

    // Call the enroll endpoint to enroll this lead in all matching flows
    const enrollUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/automation/engine/enroll`;

    const enrollResponse = await fetch(enrollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id,
        event: "purchase_completed",
      }),
    });

    const enrollResult = await enrollResponse.json();

    debug.enrolled_flows = enrollResult.enrolled_flows || 0;

    if (!enrollResponse.ok) {
      debug.errors.push(`Enroll failed: ${enrollResult.error || "Unknown error"}`);
      return res.status(enrollResponse.status).json({
        ok: false,
        error: "Enrollment failed",
        enroll_result: enrollResult,
        debug,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Purchase completed webhook processed successfully",
      enrolled_flows: enrollResult.enrolled_flows || 0,
      runs_created: enrollResult.runs_created || 0,
      debug,
      enroll_result: enrollResult,
    });
  } catch (err) {
    console.error("purchase-completed webhook error:", err);
    debug.errors.push(err?.message || String(err));
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      debug,
    });
  }
}
