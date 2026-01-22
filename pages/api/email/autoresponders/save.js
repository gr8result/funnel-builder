// /pages/api/email/autoresponders/save.js
// FULL REPLACEMENT
//
// ✅ Saves autoresponder to email_automations
// ✅ AFTER SAVE: auto-enrolls existing list members into email_autoresponder_queue
// ✅ BULLETPROOF member loading:
//    1) tries lead_list_members (preferred)
//    2) if none found, tries email_list_members
// ✅ Looks up emails/names from leads table when needed
// ✅ De-dupes using your DB unique indexes
// ✅ Returns debug info: where members came from, how many found, why skipped, etc.
//
// AUTH: Bearer token (Supabase session)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();

const SERVICE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE ||
    "").trim();

function s(v) {
  return String(v ?? "").trim();
}

function msg(err) {
  return err?.message || err?.hint || err?.details || String(err || "");
}

function getBearer(req) {
  const raw = String(req.headers?.authorization || "");
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

function isEmail(v) {
  const x = s(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

async function loadMembers({ supabaseAdmin, user_id, list_id }) {
  // We will try two tables (because your project contains both):
  // 1) lead_list_members (common in your CRM)
  // 2) email_list_members (older / alternate)
  // Return a unified array: { lead_id, email, name }

  // Try lead_list_members first
  let source = "lead_list_members";
  let members = [];
  let leadIds = [];

  const { data: llm, error: llmErr } = await supabaseAdmin
    .from("lead_list_members")
    .select("lead_id,email")
    .eq("list_id", list_id);

  if (!llmErr && Array.isArray(llm) && llm.length) {
    members = llm.map((m) => ({
      lead_id: s(m?.lead_id) || null,
      email: s(m?.email).toLowerCase() || "",
      name: "",
    }));
    leadIds = Array.from(new Set(members.map((m) => s(m.lead_id)).filter(Boolean)));
  } else {
    // Fallback to email_list_members
    source = "email_list_members";
    const { data: elm, error: elmErr } = await supabaseAdmin
      .from("email_list_members")
      .select("lead_id,email,name")
      .eq("user_id", user_id)
      .eq("list_id", list_id);

    if (!elmErr && Array.isArray(elm) && elm.length) {
      members = elm.map((m) => ({
        lead_id: s(m?.lead_id) || null,
        email: s(m?.email).toLowerCase() || "",
        name: s(m?.name) || "",
      }));
      leadIds = Array.from(new Set(members.map((m) => s(m.lead_id)).filter(Boolean)));
    } else {
      return { source, members: [], note: "No members found in either table." };
    }
  }

  // If member rows don’t include email or name, try to enrich from leads table
  if (leadIds.length) {
    const { data: leads, error: leadsErr } = await supabaseAdmin
      .from("leads")
      .select("id,email,name,first_name,last_name")
      .eq("user_id", user_id)
      .in("id", leadIds);

    if (!leadsErr && Array.isArray(leads)) {
      const map = new Map();
      for (const l of leads) {
        const id = s(l?.id);
        const email = s(l?.email).toLowerCase();
        const name =
          s(l?.name) ||
          s(`${l?.first_name || ""} ${l?.last_name || ""}`).trim() ||
          "";
        if (id) map.set(id, { email, name });
      }

      members = members.map((m) => {
        const lead = m.lead_id ? map.get(s(m.lead_id)) : null;
        const email = isEmail(m.email) ? m.email : isEmail(lead?.email) ? lead.email : "";
        const name = s(m.name) || s(lead?.name) || "";
        return { ...m, email, name };
      });
    }
  }

  // Clean
  const cleaned = members
    .map((m) => ({
      lead_id: m.lead_id ? s(m.lead_id) : null,
      email: s(m.email).toLowerCase(),
      name: s(m.name) || null,
    }))
    .filter((m) => isEmail(m.email));

  return {
    source,
    members: cleaned,
    note: cleaned.length ? "OK" : "Members found but no valid emails.",
  };
}

async function enrollExistingMembers({
  supabaseAdmin,
  user_id,
  autoresponder_id,
  list_id,
  subject,
  template_path,
}) {
  // Confirm list belongs to user (multi-tenant safe)
  const { data: listRow, error: listErr } = await supabaseAdmin
    .from("lead_lists")
    .select("id,user_id")
    .eq("id", list_id)
    .single();

  if (listErr || !listRow) {
    throw new Error("List not found in lead_lists (or no access).");
  }
  if (String(listRow.user_id) !== String(user_id)) {
    throw new Error("Forbidden: list does not belong to user.");
  }

  // Load members (from whichever table is populated)
  const lm = await loadMembers({ supabaseAdmin, user_id, list_id });

  if (!lm.members.length) {
    return { added: 0, skipped: 0, member_source: lm.source, note: lm.note };
  }

  // Pull existing queue rows for this autoresponder+list to de-dupe
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("email_autoresponder_queue")
    .select("lead_id,to_email")
    .eq("user_id", user_id)
    .eq("autoresponder_id", autoresponder_id)
    .eq("list_id", list_id);

  if (exErr) throw exErr;

  const existingLeadIds = new Set(
    (existing || []).map((r) => s(r?.lead_id)).filter(Boolean)
  );
  const existingEmails = new Set(
    (existing || []).map((r) => s(r?.to_email).toLowerCase()).filter(Boolean)
  );

  const scheduledAt = new Date().toISOString();

  const inserts = [];
  let skipped = 0;

  for (const m of lm.members) {
    const leadKey = s(m.lead_id);
    const emailKey = s(m.email).toLowerCase();

    if (leadKey && existingLeadIds.has(leadKey)) {
      skipped++;
      continue;
    }
    if (!leadKey && existingEmails.has(emailKey)) {
      skipped++;
      continue;
    }

    inserts.push({
      user_id,
      autoresponder_id,
      list_id,
      lead_id: m.lead_id || null,
      to_email: m.email,
      to_name: m.name || null,
      subject: s(subject),
      template_path: s(template_path),
      scheduled_at: scheduledAt,
      status: "queued",
      attempts: 0,
      last_error: null,
      provider_message_id: null,
      sent_at: null,
      created_at: scheduledAt,
    });
  }

  if (!inserts.length) {
    return {
      added: 0,
      skipped,
      member_source: lm.source,
      note: "All members already queued.",
    };
  }

  // Insert chunked
  const CHUNK = 200;
  let added = 0;

  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    const { error: insErr, count } = await supabaseAdmin
      .from("email_autoresponder_queue")
      .insert(chunk, { count: "exact" });

    if (insErr) {
      // If insert fails due to unique constraint (duplicates), do per-row and ignore dupes
      for (const r of chunk) {
        const { error: oneErr } = await supabaseAdmin
          .from("email_autoresponder_queue")
          .insert(r);
        if (!oneErr) added++;
      }
    } else {
      added += Number(count || chunk.length);
    }
  }

  return {
    added,
    skipped,
    member_source: lm.source,
    found_members: lm.members.length,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    });
  }

  const token = getBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user) return res.status(401).json({ ok: false, error: "Invalid session" });
    const user_id = u.user.id;

    const body = req.body || {};
    const autoresponder_id = body.autoresponder_id ? s(body.autoresponder_id) : null;

    const payload = {
      user_id,
      name: s(body.name),
      trigger_type: s(body.trigger_type || "After Signup"),
      send_day: s(body.send_day || "Same day as trigger"),
      send_time: s(body.send_time || "Same as signup time"),
      active_days: Array.isArray(body.active_days)
        ? body.active_days
        : ["Mon", "Tue", "Wed", "Thu", "Fri"],
      from_name: s(body.from_name),
      from_email: s(body.from_email),
      reply_to: s(body.reply_to),
      subject: s(body.subject),
      list_id: s(body.list_id) || null,
      template_path: s(body.template_path) || null,
      template_id: null,
      is_active: body.is_active === undefined ? true : !!body.is_active,
      updated_at: new Date().toISOString(),
    };

    if (!payload.name) return res.status(400).json({ ok: false, error: "Missing name" });
    if (!payload.subject) return res.status(400).json({ ok: false, error: "Missing subject" });
    if (!payload.list_id) return res.status(400).json({ ok: false, error: "Missing list_id" });
    if (!payload.template_path)
      return res.status(400).json({ ok: false, error: "Missing template_path" });

    let saved;

    if (autoresponder_id) {
      const { data, error } = await supabase
        .from("email_automations")
        .update(payload)
        .eq("id", autoresponder_id)
        .eq("user_id", user_id)
        .select()
        .single();

      if (error) return res.status(500).json({ ok: false, error: msg(error) });
      saved = data;
    } else {
      const { data, error } = await supabase
        .from("email_automations")
        .insert([{ ...payload, created_at: new Date().toISOString() }])
        .select()
        .single();

      if (error) return res.status(500).json({ ok: false, error: msg(error) });
      saved = data;
    }

    // Enroll immediately after save (only if active)
    let enrolled = null;
    if (saved?.is_active && saved?.list_id && saved?.template_path && saved?.subject) {
      try {
        enrolled = await enrollExistingMembers({
          supabaseAdmin,
          user_id,
          autoresponder_id: saved.id,
          list_id: saved.list_id,
          subject: saved.subject,
          template_path: saved.template_path,
        });
      } catch (e) {
        enrolled = { added: 0, skipped: 0, error: msg(e) };
      }
    } else {
      enrolled = { added: 0, skipped: 0, note: "Not active or missing required fields." };
    }

    return res.json({
      ok: true,
      data: saved,
      enrolled,
      debug: {
        list_id: saved?.list_id || null,
        autoresponder_id: saved?.id || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: msg(e) });
  }
}
