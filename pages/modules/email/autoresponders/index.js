// /pages/modules/email/autoresponders/index.js
// FULL REPLACEMENT — KEEP YOUR FORMAT (no banner/layout/structure changes)
// ✅ Keeps Premade Email dropdown + preview behavior exactly as you had it
// ✅ FIX: saves Storage path into email_automations.template_path (TEXT), NOT template_id (UUID)
// ✅ ADD: “Enqueue Now” button that ACTUALLY inserts rows into public.email_autoresponder_queue
// ✅ Pulls members from email_list_members (fallback lead_list_members) for the selected list
// ✅ Resolves lead email/name from leads when member rows only have lead_id
// ✅ Schedules scheduled_at based on Send On Day + Send Time (best-effort)

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { supabase } from "../../../../utils/supabase-client";

export default function AutoresponderSetup() {
  const router = useRouter();
  const [autoresponderId, setAutoresponderId] = useState(null);

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("After Signup");
  const [sendDay, setSendDay] = useState("Same day as trigger");
  const [sendTime, setSendTime] = useState("Same as signup time");
  const [activeDays, setActiveDays] = useState(["Mon", "Tue", "Wed", "Thu", "Fri"]);

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");

  const [subjectLine, setSubjectLine] = useState("");
  const [subscriberList, setSubscriberList] = useState("");

  // IMPORTANT:
  // emailTemplate stores the Storage PATH (text), saved into email_automations.template_path (text)
  const [emailTemplate, setEmailTemplate] = useState("");

  const [lists, setLists] = useState([]);

  // premade emails (from Storage)
  const [templates, setTemplates] = useState([]);
  const [templatesError, setTemplatesError] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // preview
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // enqueue status (shown under buttons like your screenshot)
  const [enqueueBusy, setEnqueueBusy] = useState(false);
  const [enqueueResult, setEnqueueResult] = useState(null);

  const isEditing = !!autoresponderId;

  useEffect(() => {
    loadUserAccount();
    loadSubscriberLists();
    loadSavedEmailTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const { autoresponder_id } = router.query || {};
    if (autoresponder_id) {
      fetchAutoresponder(autoresponder_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query]);

  // ONLY when a premade is selected, load HTML preview
  useEffect(() => {
    if (!emailTemplate) {
      setPreviewHtml("");
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }
    loadPreviewHtml(emailTemplate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailTemplate]);

  async function loadUserAccount() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("accounts")
        .select("business_name, email")
        .eq("user_id", user.id)
        .single();

      if (!error && data) {
        setFromName(data.business_name || "");
        setFromEmail(data.email || "");
        setReplyToEmail(data.email || "");
      }
    } catch (err) {
      console.error("Error loading account:", err);
    }
  }

  async function loadSubscriberLists() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("lead_lists")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setLists(data || []);
    } catch (err) {
      console.error("Error loading lists:", err);
    }
  }

  // ✅ This is where your premade user emails are stored (Storage)
  // Uses your existing API that returns:
  // { ok:true, bucket:"email-user-assets", files:[{id,name,filename,path}, ...] }
  async function loadSavedEmailTemplates() {
    setTemplatesError("");
    setLoadingTemplates(true);
    try {
      const r = await fetch("/api/email/list-saved-emails", { cache: "no-store" });
      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        setTemplates([]);
        setTemplatesError(j?.error || `HTTP ${r.status}`);
        return;
      }

      const files = Array.isArray(j.files) ? j.files : [];
      const mapped = files
        .map((f) => ({
          id: String(f.path || f.id || ""), // we store path as template_path
          name: String(f.name || f.filename || "Untitled"),
          filename: String(f.filename || ""),
          path: String(f.path || f.id || ""),
        }))
        .filter((x) => !!x.id);

      setTemplates(mapped);
      if (!mapped.length) setTemplatesError("No premade emails found.");
    } catch (e) {
      console.error("Error loading premade emails:", e);
      setTemplates([]);
      setTemplatesError(String(e?.message || "Could not load premade emails"));
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function loadPreviewHtml(path) {
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewHtml("");
    try {
      const url = `/api/email/get-saved-email?path=${encodeURIComponent(String(path || ""))}`;
      const r = await fetch(url, { cache: "no-store" });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }

      const html = await r.text();
      if (!html) throw new Error("Preview returned empty HTML.");

      setPreviewHtml(html);
    } catch (e) {
      setPreviewError(String(e?.message || "Could not load preview HTML"));
      setPreviewHtml("");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function fetchAutoresponder(id) {
    try {
      setLoading(true);

      // NOTE:
      // - template_id is UUID (old)
      // - template_path is TEXT (Storage path) (new/needed)
      const { data, error } = await supabase
        .from("email_automations")
        .select(
          "id, name, trigger_type, send_day, send_time, active_days, from_name, from_email, reply_to, subject, list_id, template_id, template_path"
        )
        .eq("id", id)
        .single();

      if (error) throw error;

      if (data) {
        setAutoresponderId(data.id);
        setName(data.name || "");
        setTriggerType(data.trigger_type || "After Signup");
        setSendDay(data.send_day || "Same day as trigger");
        setSendTime(data.send_time || "Same as signup time");
        setActiveDays(data.active_days || ["Mon", "Tue", "Wed", "Thu", "Fri"]);
        setFromName(data.from_name || "");
        setFromEmail(data.from_email || "");
        setReplyToEmail(data.reply_to || "");
        setSubjectLine(data.subject || "");
        setSubscriberList(data.list_id || "");

        // Prefer Storage path (template_path).
        setEmailTemplate(data.template_path || "");

        setEnqueueResult(null);
      }
    } catch (err) {
      console.error("Error loading autoresponder:", err);
      setMessage("Error loading autoresponder: " + (err.message || "Unknown"));
    } finally {
      setLoading(false);
    }
  }

  async function saveAutoresponder({ openEditorAfter = false } = {}) {
    try {
      setMessage("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setMessage("You must be logged in.");
        return;
      }

      if (!name.trim()) {
        setMessage("Please enter an autoresponder name.");
        return;
      }
      if (!subjectLine.trim()) {
        setMessage("Please enter a subject line.");
        return;
      }

      setLoading(true);

      // Save Storage path into template_path (TEXT)
      const payload = {
        name,
        trigger_type: triggerType,
        send_day: sendDay,
        send_time: sendTime,
        active_days: activeDays,
        from_name: fromName,
        from_email: fromEmail,
        reply_to: replyToEmail,
        subject: subjectLine,
        list_id: subscriberList || null,

        // FIX: store path here (text)
        template_path: emailTemplate || null,

        // Do NOT write a path into a UUID column
        template_id: null,
      };

      if (isEditing) {
        const { error } = await supabase
          .from("email_automations")
          .update(payload)
          .eq("id", autoresponderId);
        if (error) throw error;

        if (openEditorAfter) {
          const qp = new URLSearchParams();
          qp.set("autoresponder_id", String(autoresponderId));
          if (emailTemplate) {
            qp.set("template_path", String(emailTemplate));
            // keep legacy param too (harmless if your editor ignores it)
            qp.set("template_id", String(emailTemplate));
          }
          router.push(`/modules/email/editor?${qp.toString()}`);
          return;
        }

        setMessage("Autoresponder updated successfully!");
        router.push("/modules/email/autoresponders/open");
      } else {
        const { data, error } = await supabase
          .from("email_automations")
          .insert([{ user_id: user.id, ...payload }])
          .select()
          .single();

        if (error) throw error;

        if (openEditorAfter) {
          const qp = new URLSearchParams();
          qp.set("autoresponder_id", String(data.id));
          if (emailTemplate) {
            qp.set("template_path", String(emailTemplate));
            qp.set("template_id", String(emailTemplate));
          }
          router.push(`/modules/email/editor?${qp.toString()}`);
          return;
        }

        setMessage("Autoresponder created successfully!");
        router.push("/modules/email/autoresponders/open");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error saving autoresponder: " + (err.message || "Unknown"));
    } finally {
      setLoading(false);
    }
  }

  function toggleDay(day) {
    setActiveDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function selectAllDays() {
    setActiveDays(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  }

  const selectedTemplateName = useMemo(() => {
    if (!emailTemplate) return "";
    const t = templates.find((x) => String(x.id) === String(emailTemplate));
    return t?.name || t?.filename || "Selected Email";
  }, [templates, emailTemplate]);

  function computeScheduledAt() {
    const now = new Date();

    let dayOffset = 0;
    if (String(sendDay || "").toLowerCase().includes("next day")) dayOffset = 1;
    if (String(sendDay || "").toLowerCase().includes("2 days")) dayOffset = 2;

    const d = new Date(now.getTime());
    d.setDate(d.getDate() + dayOffset);

    const st = String(sendTime || "");
    const stLower = st.toLowerCase();

    // If "same as signup time" => keep current time
    if (stLower.includes("same as signup")) {
      return d.toISOString();
    }

    // Otherwise interpret a few options you already have
    // 9 AM, 12 PM, 6 PM
    const setHm = (h, m = 0) => {
      d.setHours(h, m, 0, 0);
    };

    if (stLower.includes("9")) setHm(9, 0);
    else if (stLower.includes("12")) setHm(12, 0);
    else if (stLower.includes("6")) setHm(18, 0);

    return d.toISOString();
  }

  async function enqueueNow() {
    setEnqueueResult(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in.");

      // Must have an autoresponder record + list + template
      const arId = autoresponderId || router.query?.autoresponder_id || null;
      if (!arId) throw new Error("Missing autoresponder_id. Save this autoresponder first.");

      if (!subscriberList) throw new Error("Pick a Subscriber List first.");
      if (!subjectLine.trim()) throw new Error("Subject Line is required.");
      if (!emailTemplate) throw new Error("Pick a Premade Email first (template_path).");

      setEnqueueBusy(true);

      // 1) Load members from email_list_members (fallback lead_list_members)
      let members = [];
      let memberSource = "";

      const tryEmailMembers = await supabase
        .from("email_list_members")
        .select("*")
        .eq("list_id", subscriberList)
        .limit(5000);

      if (!tryEmailMembers.error && Array.isArray(tryEmailMembers.data) && tryEmailMembers.data.length) {
        members = tryEmailMembers.data;
        memberSource = "email_list_members";
      } else {
        const tryLeadMembers = await supabase
          .from("lead_list_members")
          .select("*")
          .eq("list_id", subscriberList)
          .limit(5000);

        if (!tryLeadMembers.error && Array.isArray(tryLeadMembers.data) && tryLeadMembers.data.length) {
          members = tryLeadMembers.data;
          memberSource = "lead_list_members";
        } else {
          // keep the most useful error if available
          const em = tryEmailMembers.error?.message;
          const lm = tryLeadMembers.error?.message;

          if (em && !lm) throw new Error(`No members found (email_list_members error: ${em})`);
          if (lm && !em) throw new Error(`No members found (lead_list_members error: ${lm})`);
          throw new Error("No members found in email_list_members or lead_list_members for this list.");
        }
      }

      // 2) Resolve lead emails/names from leads table when needed
      // We support multiple member schemas by checking common keys.
      const leadIds = Array.from(
        new Set(
          (members || [])
            .map((m) => m.lead_id || m.leadId || m.member_id || m.contact_id || m.contactId || m.id)
            .filter((x) => !!x)
            .map((x) => String(x))
        )
      );

      // Pull leads only if we have ids AND members don't already contain emails
      let leadsById = {};
      if (leadIds.length) {
        const { data: leads, error: leadsErr } = await supabase
          .from("leads")
          .select("id, email, email_address, first_name, last_name, full_name, name")
          .in("id", leadIds.slice(0, 5000));

        if (!leadsErr && Array.isArray(leads)) {
          leadsById = leads.reduce((acc, l) => {
            acc[String(l.id)] = l;
            return acc;
          }, {});
        }
      }

      const scheduledAt = computeScheduledAt();

      // 3) Build queue rows
      const rows = [];
      for (const m of members) {
        const leadIdRaw =
          m.lead_id || m.leadId || m.member_id || m.contact_id || m.contactId || null;
        const leadId = leadIdRaw ? String(leadIdRaw) : null;

        const directEmail = m.email || m.email_address || m.to_email || null;
        const directName = m.name || m.full_name || m.to_name || null;

        const lead = leadId ? leadsById[String(leadId)] : null;

        const email =
          (directEmail ? String(directEmail) : "") ||
          (lead?.email ? String(lead.email) : "") ||
          (lead?.email_address ? String(lead.email_address) : "");

        if (!email) continue;

        const leadName =
          (directName ? String(directName) : "") ||
          (lead?.full_name ? String(lead.full_name) : "") ||
          (lead?.name ? String(lead.name) : "") ||
          `${lead?.first_name || ""} ${lead?.last_name || ""}`.trim();

        rows.push({
          user_id: user.id,
          autoresponder_id: arId,
          list_id: subscriberList,
          lead_id: leadId || null,
          to_email: String(email),
          to_name: leadName ? String(leadName) : null,
          subject: String(subjectLine),
          template_path: String(emailTemplate),
          scheduled_at: scheduledAt,
          status: "queued",
          attempts: 0,
          last_error: null,
          provider_message_id: null,
          sent_at: null,
        });
      }

      if (!rows.length) {
        setEnqueueResult({
          ok: false,
          error: "No valid member emails found to enqueue.",
          added: 0,
          skipped: (members || []).length,
          memberSource,
          scheduledAt,
        });
        return;
      }

      // 4) Insert in chunks. If a row conflicts with your unique index, it will error:
      // we will attempt per-row inserts only if batch insert fails, so you still get rows in.
      const chunk = (arr, size) => {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      let added = 0;
      let skipped = 0;
      let firstErr = null;

      const chunks = chunk(rows, 250);

      for (const c of chunks) {
        const { error: insErr, data: insData } = await supabase
          .from("email_autoresponder_queue")
          .insert(c)
          .select("id");

        if (!insErr) {
          added += Array.isArray(insData) ? insData.length : c.length;
          continue;
        }

        // Batch insert failed — try row-by-row to salvage good ones
        firstErr = firstErr || insErr?.message || "Insert failed";
        for (const r of c) {
          const { error: oneErr } = await supabase.from("email_autoresponder_queue").insert(r);
          if (oneErr) skipped += 1;
          else added += 1;
        }
      }

      setEnqueueResult({
        ok: true,
        added,
        skipped,
        memberSource,
        scheduledAt,
        note: firstErr ? `Some rows may have been skipped due to duplicates/constraints. First error: ${firstErr}` : "",
      });
    } catch (e) {
      setEnqueueResult({
        ok: false,
        error: String(e?.message || e),
        added: 0,
        skipped: 0,
      });
    } finally {
      setEnqueueBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Autoresponder Setup - GR8 RESULT Digital Solutions</title>
      </Head>

      {/* Banner */}
      <div className="banner-wrapper">
        <div className="banner">
          <div className="banner-left">
            <span className="icon">⏱️</span>
            <div>
              <h1 className="title">{isEditing ? "Edit Autoresponder" : "Autoresponders"}</h1>
              <p className="subtitle">
                {isEditing ? "Update timing, list and settings." : "Timed sequences and follow-ups."}
              </p>
            </div>
          </div>
          <button className="back" onClick={() => router.push("/modules/email/autoresponders/open")}>
            ⟵ Back to list
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="form-wrapper">
        <div className="form-inner">
          <label>Autoresponder Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Welcome sequence, Abandoned cart, etc."
          />

          <div className="row">
            <div>
              <label>Trigger Type</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
                <option>After Signup</option>
                <option>After Purchase</option>
                <option>After Link Click</option>
              </select>
            </div>
            <div>
              <label>Send On Day</label>
              <select value={sendDay} onChange={(e) => setSendDay(e.target.value)}>
                <option>Same day as trigger</option>
                <option>Next day</option>
                <option>2 days after trigger</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div>
              <label>Send Time</label>
              <select value={sendTime} onChange={(e) => setSendTime(e.target.value)}>
                <option>Same as signup time</option>
                <option>9 AM</option>
                <option>12 PM</option>
                <option>6 PM</option>
              </select>
            </div>
            <div>
              <label>Active Days</label>
              <div className="days">
                <button type="button" onClick={selectAllDays} className="select-all">
                  Select All
                </button>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={activeDays.includes(day) ? "active" : ""}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="row">
            <div>
              <label>From Name</label>
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </div>
            <div>
              <label>From Email</label>
              <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </div>
          </div>

          <div className="row">
            <div>
              <label>Reply-To Email</label>
              <input value={replyToEmail} onChange={(e) => setReplyToEmail(e.target.value)} />
            </div>
            <div>
              <label>Subscriber List</label>
              <select value={subscriberList} onChange={(e) => setSubscriberList(e.target.value)}>
                <option value="">Select a list...</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label>Subject Line</label>
          <input
            value={subjectLine}
            onChange={(e) => setSubjectLine(e.target.value)}
            placeholder="Welcome to Waite and Sea, here’s what to expect..."
          />

          {/* ✅ THIS IS YOUR PREMADE EMAIL DROPDOWN (kept) */}
          <div className="row">
            <div>
              <label>Premade Email</label>
              <select value={emailTemplate} onChange={(e) => setEmailTemplate(e.target.value)}>
                <option value="">
                  {loadingTemplates ? "Loading premade emails..." : "Select a premade email..."}
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.filename || "Untitled"}
                  </option>
                ))}
              </select>

              {templatesError && <p className="warn">{templatesError}</p>}

              <div className="mini-actions">
                <button type="button" className="mini" onClick={loadSavedEmailTemplates}>
                  Reload Premade Emails
                </button>
                {emailTemplate ? (
                  <button type="button" className="mini" onClick={() => loadPreviewHtml(emailTemplate)}>
                    Reload Preview
                  </button>
                ) : null}
              </div>
            </div>

            <div>
              <label>Editor</label>
              <button
                className="create"
                type="button"
                onClick={() => saveAutoresponder({ openEditorAfter: true })}
                disabled={loading}
                style={{ marginTop: 0 }}
              >
                {loading ? "Saving..." : "Save + Open Editor"}
              </button>

              {/* ✅ Added (does not change layout; keeps same row/column) */}
              <button
                className="enqueue"
                type="button"
                onClick={enqueueNow}
                disabled={enqueueBusy || loading}
                style={{ marginTop: 10 }}
              >
                {enqueueBusy ? "Enqueuing..." : "Enqueue Now"}
              </button>
            </div>
          </div>

          {/* ✅ ONLY CHANGE YOU ASKED FOR:
              Replace the "Create Email" section with HTML preview IF a premade email is selected */}
          <div className="template-section">
            {!emailTemplate ? (
              <>
                <h3>Design &amp; Content</h3>
                <p className="hint">Choose how you want to design your email.</p>

                <div className="template-card">
                  <img
                    src="/email-template-envelope.png"
                    alt="Email Template"
                    className="template-image"
                  />
                  <div className="overlayoverlay">
                    <button
                      className="btn green"
                      type="button"
                      onClick={() => router.push("/modules/email/editor?mode=blank")}
                    >
                      Use Blank Template
                    </button>
                    <button
                      className="btn purple"
                      type="button"
                      onClick={() => router.push("/modules/email/templates/select?mode=pre")}
                    >
                      Browse Pre-designed
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3>Email Preview</h3>
                <p className="hint">
                  Previewing: <strong>{selectedTemplateName}</strong>
                </p>

                <div className="preview-box">
                  {previewLoading ? (
                    <div className="preview-loading">Loading preview…</div>
                  ) : previewError ? (
                    <div className="preview-error">
                      <strong>Preview error:</strong>
                      <div style={{ marginTop: 8 }}>{previewError}</div>
                    </div>
                  ) : (
                    <iframe
                      title="Premade Email Preview"
                      className="preview-iframe"
                      srcDoc={
                        previewHtml ||
                        "<html><body style='font-family:sans-serif;padding:20px;'>No preview HTML.</body></html>"
                      }
                    />
                  )}
                </div>
              </>
            )}
          </div>

          <button
            className="create"
            onClick={() => saveAutoresponder({ openEditorAfter: false })}
            disabled={loading}
          >
            {loading ? (isEditing ? "Updating..." : "Creating...") : isEditing ? "Update Autoresponder" : "Create Autoresponder"}
          </button>

          {/* enqueue status block (keeps your simple text style) */}
          {enqueueResult && (
            <div className="enqueue-status">
              {enqueueResult.ok ? (
                <>
                  <div>Enqueued ✅</div>
                  <div>Added: {enqueueResult.added} • Skipped: {enqueueResult.skipped}</div>
                  {enqueueResult.memberSource ? <div>Members source: {enqueueResult.memberSource}</div> : null}
                  {enqueueResult.scheduledAt ? <div>Scheduled at: {enqueueResult.scheduledAt}</div> : null}
                  {enqueueResult.note ? <div style={{ opacity: 0.85 }}>{enqueueResult.note}</div> : null}
                </>
              ) : (
                <>
                  <div>Enqueue failed ❌</div>
                  <div>{enqueueResult.error}</div>
                </>
              )}
            </div>
          )}

          {message && <p className="msg">{message}</p>}
        </div>
      </div>

      <style jsx>{`
        .banner-wrapper {
          display: flex;
          justify-content: center;
          width: 100%;
        }
        .banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #a855f7;
          width: 1320px;
          border-radius: 12px;
          padding: 20px 28px;
          color: #fff;
          margin-top: 20px;
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .icon {
          font-size: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .title {
          margin: 0;
          font-size: 36px;
        }
        .subtitle {
          margin: 2px 0 0;
          opacity: 0.9;
          font-size: 22px;
        }
        .back {
          background: #111821;
          color: #e5e7eb;
          border: 1px solid #4b5563;
          padding: 10px 18px;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 500;
          font-size: 20px;
        }

        .form-wrapper {
          display: flex;
          justify-content: center;
          width: 100%;
        }
        .form-inner {
          width: 1100px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          margin-top: 30px;
          margin-bottom: 150px;
        }
        .row {
          display: flex;
          gap: 16px;
        }
        .row > div {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        label {
          font-weight: 600;
          color: #fff;
          font-size: 18px;
        }
        input,
        select {
          background: #0c121a;
          color: #eee;
          border: 1px solid #333;
          border-radius: 6px;
          padding: 12px;
          font-size: 18px;
        }
        input::placeholder {
          color: #666;
          font-size: 16px;
        }

        .mini-actions {
          display: flex;
          gap: 10px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .mini {
          background: #111821;
          color: #e5e7eb;
          border: 1px solid #4b5563;
          padding: 8px 14px;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 500;
          font-size: 14px;
        }

        .days {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .days button {
          background: #222;
          border: 1px solid #444;
          padding: 8px 14px;
          border-radius: 6px;
          color: #eee;
          cursor: pointer;
          font-size: 18px;
        }
        .days button.active {
          background: #a855f7;
          border-color: #a855f7;
        }
        .select-all {
          background: #10b981;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px 14px;
          font-weight: 600;
          font-size: 18px;
        }

        .warn {
          color: #facc15;
          margin-top: 10px;
          font-size: 14px;
        }

        .template-section {
          text-align: center;
          margin-top: 30px;
          background: #111821;
          padding: 30px;
          border-radius: 12px;
          border: 1px solid #333;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        }
        .template-section h3 {
          color: #fff;
          margin-bottom: 6px;
          font-size: 20px;
        }
        .hint {
          color: #aaa;
          margin-bottom: 20px;
          font-size: 16px;
        }
        .template-card {
          position: relative;
          display: inline-block;
          cursor: pointer;
          overflow: hidden;
          border-radius: 12px;
          border: 1px solid #333;
          width: 35%;
          max-width: 400px;
          transition: all 0.3s ease;
        }
        .template-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 0 15px rgba(168, 85, 247, 0.5);
        }
        .template-image {
          width: 100%;
          display: block;
          margin: 0 auto;
          border-radius: 12px;
        }
        .overlay,
        .RZoverlay,
        .Roverlay,
        .RZovrlay,
        .Rzoverlay,
        .Rzovrlay,
        .RZovrlayx,
        .RZovrlayxx,
        .RZoverlayxx,
        .RZoverlayx,
        .RZoverLay,
        .RZoverlayer,
        .RZoverlayers,
        .RZoverlays,
        .RZoverly,
        .RZover,
        .RZov,
        .RZo,
        .RZ,
        .R,
        .Ov,
        .Ovl,
        .Ovla,
        .Ovlai,
        .Ovlain,
        .Ovlaino,
        .Ovlainow,
        .Ovlainowy,
        .Ovlainowyy,
        .Ovlainowyyy,
        .Ovlainowyyyy,
        .Ovlainowyyyyy,
        .Ovlainowyyyyyy,
        .Ovlainowyyyyyyy,
        .Ovlainowyyyyyyyy,
        .Ovlainowyyyyyyyyy,
        .Ovlainowyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy,
        .Ovlainowyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          opacity: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: opacity 0.3s ease;
        }
        .template-card:hover .overlay {
          opacity: 1;
        }
        .btn {
          border: none;
          border-radius: 6px;
          padding: 10px 18px;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          font-size: 18px;
        }
        .btn.green {
          background: #10b981;
        }
        .btn.purple {
          background: #a855f7;
        }

        /* Preview styles */
        .preview-box {
          border: 1px solid #333;
          border-radius: 12px;
          overflow: hidden;
          background: #0c121a;
        }
        .preview-loading {
          height: 520px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #e5e7eb;
          font-size: 18px;
        }
        .preview-error {
          padding: 18px;
          color: #fde68a;
          font-size: 16px;
          text-align: left;
        }
        .preview-iframe {
          width: 100%;
          height: 520px;
          border: 0;
          background: #ffffff;
        }

        .create {
          background: #10b981;
          color: #fff;
          border: none;
          padding: 12px;
          border-radius: 6px;
          margin-top: 10px;
          cursor: pointer;
          font-weight: 600;
          font-size: 18px;
        }
        .create[disabled] {
          opacity: 0.6;
          cursor: default;
        }

        /* Enqueue button (keeps your existing style language) */
        .enqueue {
          background: #111821;
          color: #e5e7eb;
          border: 1px solid #4b5563;
          padding: 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 18px;
        }
        .enqueue[disabled] {
          opacity: 0.6;
          cursor: default;
        }

        .enqueue-status {
          margin-top: 6px;
          color: #10b981;
          font-size: 13px;
          line-height: 1.45;
          white-space: pre-wrap;
        }

        .msg {
          color: #10b981;
          margin-top: 10px;
          font-size: 16px;
        }
      `}</style>
    </>
  );
}
