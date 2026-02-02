// /pages/modules/email/broadcast/index.js
// FULL REPLACEMENT
// Keeps your layout/banner
// ✅ Renames Subject A/B to Subject Line A/B
// ✅ Adds AI buttons to generate subject lines (single + A/B)
// ✅ Explains Preheader clearly (one preheader used for both A/B variants)
// ✅ Uses Bearer token for /api/email/send-broadcast (Unauthorized fix stays)

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../../utils/supabase-client";
import styles from "../../../../styles/email-crm.module.css";

const EMAIL_TYPES = ["broadcast", "autoresponders", "templates"];
const lsKey = (type) => "gr8:new-email:" + (type || "broadcast");
const isEmail = (v) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

const initialForm = {
  name: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  audienceType: "",
  audience: "",
  subject: "",
  preheader: "",
  utm_source: "email",
  utm_medium: "broadcast",
  utm_campaigns: "",
  outline: "",
  savedEmailPath: "",
  body: "",
  bodyHtml: "",
  abEnabled: false,
  abSubjectA: "",
  abSubjectB: "",
};

export default function CreateEmail() {
  const router = useRouter();
  const { type: rawType, broadcastId: rawBroadcastId } = router.query;

  const broadcastId = useMemo(() => {
    if (!rawBroadcastId) return null;
    if (Array.isArray(rawBroadcastId)) return rawBroadcastId[0] || null;
    return String(rawBroadcastId);
  }, [rawBroadcastId]);

  const type = useMemo(
    () => (EMAIL_TYPES.includes(String(rawType)) ? String(rawType) : "broadcast"),
    [rawType]
  );

  const [form, setForm] = useState(initialForm);
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [lists, setLists] = useState([]);
  const [savedEmails, setSavedEmails] = useState([]);
  const [savedEmailsLoading, setSavedEmailsLoading] = useState(false);
  const [savedEmailsError, setSavedEmailsError] = useState("");

  const [dkimVerified, setDkimVerified] = useState(null);
  const [dkimDomain, setDkimDomain] = useState("");

  const [sendMode, setSendMode] = useState("now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  const [testEmail, setTestEmail] = useState("");

  // ✅ SendGrid Sandbox toggle (no delivery)
  const [sandbox, setSandbox] = useState(false);

  // AI subject generator UI state
  const [aiBusy, setAiBusy] = useState(false);
  const [aiContext, setAiContext] = useState(""); // optional helper text
  const [aiTone, setAiTone] = useState("friendly, professional");
  const [aiLastError, setAiLastError] = useState("");

  // local draft
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey(type)) || "null");
      if (saved && typeof saved === "object") setForm((f) => ({ ...f, ...saved }));
    } catch {}
  }, [type]);

  useEffect(() => {
    try {
      localStorage.setItem(lsKey(type), JSON.stringify(form));
    } catch {}
  }, [form, type]);

  // load user, lists, finished emails, and broadcast if editing
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // ✅ Always seed defaults so fromEmail is never blank
      setForm((f) => ({
        ...f,
        fromName: f.fromName || user.user_metadata?.full_name || "",
        fromEmail: f.fromEmail || user.email || "",
        replyTo: f.replyTo || user.email || "",
      }));
      setTestEmail(user.email || "");

      // lists
      try {
        const { data: listsData, error } = await supabase
          .from("lead_lists")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (!cancelled) {
          if (error) setLoadError("Failed to load lead lists.");
          else setLists(listsData || []);
        }
      } catch {
        if (!cancelled) setLoadError("Failed to load lead lists.");
      }

      // finished emails
      try {
        if (cancelled) return;
        setSavedEmailsLoading(true);

        const basePrefix = `${user.id}/finished-emails`;
        const { data: files, error: filesError } = await supabase.storage
          .from("email-user-assets")
          .list(basePrefix, { limit: 500 });

        if (!cancelled) {
          if (!filesError && Array.isArray(files)) {
            const htmlFiles = files.filter((f) =>
              (f.name || "").toLowerCase().endsWith(".html")
            );
            setSavedEmails(
              htmlFiles.map((f) => ({
                label: f.name.replace(/\.html$/i, ""),
                path: `${basePrefix}/${f.name}`,
              }))
            );
            setSavedEmailsError("");
          } else {
            setSavedEmails([]);
            setSavedEmailsError("");
          }
        }
      } catch {
        if (!cancelled) {
          setSavedEmails([]);
          setSavedEmailsError("Failed to load finished emails.");
        }
      } finally {
        if (!cancelled) setSavedEmailsLoading(false);
      }

      // preload broadcast (editing)
      if (!cancelled && broadcastId) {
        try {
          const { data: bcast, error: bErr } = await supabase
            .from("email_broadcasts")
            .select("*")
            .eq("id", broadcastId)
            .eq("user_id", user.id)
            .maybeSingle();

          if (bErr) {
            setLoadError("Error loading existing broadcast.");
            return;
          }

          if (bcast) {
            const subject = bcast.subject || bcast.title || "";
            const html = bcast.html_content || "";
            const toField = bcast.to_field || "";

            const audienceTypeFromDb =
              bcast.audience_type || (toField ? "emails" : "list");
            const listIdFromDb = bcast.list_id || "";

            const abEnabledFromDb = !!(
              bcast.ab_enabled ||
              bcast.abEnabled ||
              bcast.ab_test_enabled
            );
            const abSubjectAFromDb = bcast.ab_subject_a || bcast.abSubjectA || "";
            const abSubjectBFromDb = bcast.ab_subject_b || bcast.abSubjectB || "";

            setForm((f) => ({
              ...f,
              name: bcast.title || subject || f.name || "Broadcast",
              fromName:
                bcast.from_name ||
                f.fromName ||
                user.user_metadata?.full_name ||
                "",
              fromEmail: bcast.from_email || f.fromEmail || user.email || "",
              replyTo: bcast.reply_to || f.replyTo || user.email || "",
              audienceType: audienceTypeFromDb || "emails",
              audience:
                audienceTypeFromDb === "list"
                  ? String(listIdFromDb || "")
                  : String(toField || ""),
              subject: subject || f.subject || "",
              preheader: bcast.preheader || f.preheader || "",
              savedEmailPath: bcast.saved_email_path || "",
              bodyHtml: html || "",
              body: html || "",
              abEnabled: abEnabledFromDb,
              abSubjectA: abSubjectAFromDb || subject || "",
              abSubjectB: abSubjectBFromDb || "",
            }));
          }
        } catch {
          setLoadError("Error loading existing broadcast.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [broadcastId]);

  // DKIM status
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("dkim_domain, dkim_verified")
        .maybeSingle();

      if (cancelled) return;

      if (!error && data) {
        setDkimDomain(data.dkim_domain || "");
        setDkimVerified(Boolean(data.dkim_verified));
      } else {
        setDkimVerified(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.value,
    }));

  const onTouch = (k) => () =>
    setTouched((t) => ({
      ...t,
      [k]: true,
    }));

  const toggleAbEnabled = () => {
    setForm((f) => {
      const nextEnabled = !f.abEnabled;
      const next = { ...f, abEnabled: nextEnabled };
      if (nextEnabled) {
        if (!next.abSubjectA && next.subject) next.abSubjectA = next.subject;
        if (!next.abSubjectB && next.subject)
          next.abSubjectB = next.subject + " (B)";
      }
      return next;
    });
  };

  const handleSavedEmailChange = async (e) => {
    const path = e.target.value;

    if (!path) {
      setForm((f) => ({ ...f, savedEmailPath: "" }));
      return;
    }

    setForm((f) => ({ ...f, savedEmailPath: path }));

    try {
      const bucket = supabase.storage.from("email-user-assets");
      const { data, error } = await bucket.download(path);
      if (error || !data) {
        alert("Could not load selected email content.");
        return;
      }

      const text = await data.text();
      setForm((f) => ({ ...f, bodyHtml: text, body: text }));
    } catch {
      alert("Could not load selected email content.");
    }
  };

  const errors = useMemo(() => {
    const err = {};
    if (!form.name?.trim()) err.name = "Broadcast name is required.";
    if (!form.fromName?.trim()) err.fromName = "From name is required.";
    if (!isEmail(form.fromEmail))
      err.fromEmail = "Valid from email is required.";
    if (form.replyTo && !isEmail(form.replyTo))
      err.replyTo = "Reply-to must be valid.";
    if (!form.subject?.trim()) err.subject = "Subject is required.";
    if (!form.preheader?.trim()) err.preheader = "Preheader is required.";

    if (!form.audienceType) {
      err.audienceType = "Select an audience type.";
    } else if (form.audienceType === "emails") {
      if (!(form.audience || "").trim())
        err.audience = "Enter at least one email address.";
    } else if (form.audienceType === "list") {
      if (!form.audience) err.audience = "Choose a list to send to.";
    }

    if (!form.bodyHtml?.trim() && !form.body?.trim()) {
      err.bodyHtml = "Email content is required.";
    }

    if (sendMode === "schedule" && (!scheduleDate || !scheduleTime)) {
      err.schedule = "Choose a date and time for scheduled send.";
    }

    if (form.abEnabled) {
      if (!form.abSubjectA?.trim()) err.abSubjectA = "Subject Line A is required.";
      if (!form.abSubjectB?.trim()) err.abSubjectB = "Subject Line B is required.";
    }

    return err;
  }, [form, sendMode, scheduleDate, scheduleTime]);

  const isValid = Object.keys(errors).length === 0;
  const isEditing = Boolean(broadcastId);

  // ✅ helper: get access token for API calls
  const getBearerToken = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || "";
    return token;
  };

  // ✅ AI Subject Generator
  const buildAiEmailText = () => {
    const html = (form.bodyHtml || form.body || "").trim();
    if (!html) return "";

    // Keep it simple: strip tags-ish for a short context
    const text = html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 1200);
  };

  const generateSubjectsSingle = async () => {
    try {
      setAiLastError("");
      setAiBusy(true);

      const emailText = buildAiEmailText();

      const payload = {
        context: (aiContext || "").trim(),
        tone: (aiTone || "").trim(),
        audience:
          form.audienceType === "list"
            ? "Existing list"
            : "Specific emails",
        offer: (form.name || "").trim(),
        preheader: (form.preheader || "").trim(),
        emailText,
        wantAB: false,
      };

      const res = await fetch("/api/ai/subject-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("AI returned non-JSON:\n\n" + raw.slice(0, 900));
      }

      if (!res.ok || !json.ok) {
        throw new Error(json?.error || "AI subject generation failed.");
      }

      const subject = String(json.subject || "").trim();
      if (!subject) throw new Error("AI returned an empty subject.");

      setForm((f) => ({ ...f, subject }));
      setTouched((t) => ({ ...t, subject: true }));
    } catch (e) {
      setAiLastError(String(e?.message || "AI error"));
      alert("AI error: " + (e?.message || "Unknown error"));
    } finally {
      setAiBusy(false);
    }
  };

  const generateSubjectsAB = async () => {
    try {
      setAiLastError("");
      setAiBusy(true);

      const emailText = buildAiEmailText();

      const payload = {
        context: (aiContext || "").trim(),
        tone: (aiTone || "").trim(),
        audience:
          form.audienceType === "list"
            ? "Existing list"
            : "Specific emails",
        offer: (form.name || "").trim(),
        preheader: (form.preheader || "").trim(),
        emailText,
        wantAB: true,
      };

      const res = await fetch("/api/ai/subject-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("AI returned non-JSON:\n\n" + raw.slice(0, 900));
      }

      if (!res.ok || !json.ok) {
        throw new Error(json?.error || "AI subject generation failed.");
      }

      const subjectA = String(json.subjectA || "").trim();
      const subjectB = String(json.subjectB || "").trim();
      if (!subjectA || !subjectB) throw new Error("AI returned empty A/B subjects.");

      setForm((f) => ({
        ...f,
        abSubjectA: subjectA,
        abSubjectB: subjectB,
      }));
      setTouched((t) => ({ ...t, abSubjectA: true, abSubjectB: true }));
    } catch (e) {
      setAiLastError(String(e?.message || "AI error"));
      alert("AI error: " + (e?.message || "Unknown error"));
    } finally {
      setAiBusy(false);
    }
  };

  const handleSend = async () => {
    setTouched((t) => ({
      ...t,
      name: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      subject: true,
      preheader: true,
      audienceType: true,
      audience: true,
      bodyHtml: true,
      ...(form.abEnabled ? { abSubjectA: true, abSubjectB: true } : {}),
    }));

    if (!isValid) {
      alert("Please fix the highlighted fields before sending.");
      return;
    }

    try {
      setBusy(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        alert("You must be logged in.");
        return;
      }

      const token = await getBearerToken();
      if (!token) {
        alert("You must be logged in.");
        return;
      }

      let sendAt = null;
      if (sendMode === "schedule") {
        sendAt = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      }

      const html = (form.bodyHtml || form.body || "").trim();
      const subject = (form.subject || "").trim();

      let recipients = [];
      let audienceValue = form.audience;

      if (form.audienceType === "emails") {
        const cleaned = (form.audience || "")
          .split(/[,;\n]/)
          .map((e) => e.trim())
          .filter(Boolean);

        recipients = cleaned.filter(isEmail);
        if (!recipients.length) {
          alert("Please enter at least one valid email address.");
          return;
        }

        audienceValue = recipients.join(",");
      } else if (form.audienceType === "list") {
        audienceValue = String(form.audience || "");
        if (!audienceValue) {
          alert("Choose a list to send to.");
          return;
        }
      } else {
        alert("Choose a valid audience type.");
        return;
      }

      const safeFromEmail = (form.fromEmail || user.email || "").trim();
      const safeFromName = (
        form.fromName ||
        user.user_metadata?.full_name ||
        "GR8 RESULT"
      ).trim();
      const safeReplyTo = (form.replyTo || safeFromEmail).trim();

      const payload = {
        mode: "broadcast",
        broadcastId: isEditing ? broadcastId : null,

        sendMode,
        sendAt,
        subject,
        preheader: (form.preheader || "").trim(),
        html,
        audienceType: form.audienceType,
        audience: audienceValue,

        fromEmail: safeFromEmail,
        fromName: safeFromName,
        replyTo: safeReplyTo,

        abEnabled: Boolean(form.abEnabled),
        abSubjectA: form.abEnabled ? (form.abSubjectA || "").trim() : "",
        abSubjectB: form.abEnabled ? (form.abSubjectB || "").trim() : "",

        recipients: form.audienceType === "emails" ? recipients : [],
        recipientCountHint:
          form.audienceType === "list" ? "list" : recipients.length,

        sandbox: Boolean(sandbox),

        form: {
          ...form,
          fromEmail: safeFromEmail,
          fromName: safeFromName,
          replyTo: safeReplyTo,
          audience: audienceValue,
        },
      };

      const res = await fetch("/api/email/send-broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`, // ✅ FIX (Unauthorized)
        },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("Server returned non-JSON:\n\n" + raw.slice(0, 900));
      }

      if (!res.ok || !json.success) {
        throw new Error(json?.error || "Failed to send broadcast.");
      }

      if (!isEditing && json.broadcastId) {
        router.replace(
          `/modules/email/broadcast?mode=edit&broadcastId=${json.broadcastId}`
        );
      }

      alert(
        sandbox
          ? `✅ SANDBOX accepted (NO DELIVERY). ${
              json.ab_enabled ? `Split: A=${json.split?.A}, B=${json.split?.B}` : ""
            }`
          : sendMode === "now"
          ? `Broadcast sent.${
              json.ab_enabled ? ` A/B split: A=${json.split?.A}, B=${json.split?.B}` : ""
            }`
          : "Broadcast scheduled successfully."
      );
    } catch (err) {
      alert("Error sending broadcast: " + (err.message || "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const handleSendTest = async () => {
    const email = (testEmail || "").trim();
    if (!isEmail(email)) {
      alert("Please enter a valid test email address.");
      return;
    }

    try {
      setBusy(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        alert("You must be logged in.");
        return;
      }

      const token = await getBearerToken();
      if (!token) {
        alert("You must be logged in.");
        return;
      }

      const html = (form.bodyHtml || form.body || "").trim();
      const subject = (form.subject || "").trim();

      const safeFromEmail = (form.fromEmail || user.email || "").trim();
      const safeFromName = (
        form.fromName ||
        user.user_metadata?.full_name ||
        "GR8 RESULT"
      ).trim();
      const safeReplyTo = (form.replyTo || safeFromEmail).trim();

      const payload = {
        mode: "test",
        testEmail: email,
        subject,
        preheader: (form.preheader || "").trim(),
        html,
        fromEmail: safeFromEmail,
        fromName: safeFromName,
        replyTo: safeReplyTo,

        sandbox: Boolean(sandbox),

        form: {
          ...form,
          fromEmail: safeFromEmail,
          fromName: safeFromName,
          replyTo: safeReplyTo,
        },
      };

      const res = await fetch("/api/email/send-broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`, // ✅ FIX (Unauthorized)
        },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error("Server returned non-JSON:\n\n" + raw.slice(0, 900));
      }

      if (!res.ok || !json.success)
        throw new Error(json?.error || "Failed to send test email.");

      alert(
        sandbox
          ? `✅ SANDBOX accepted (NO DELIVERY) to ${email}`
          : "Test email sent to " + email
      );
    } catch (err) {
      alert("Could not send test email: " + (err.message || "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const onContinueToTemplates = async () => {
    try {
      setBusy(true);
      localStorage.setItem(lsKey(type), JSON.stringify(form));
      await router.push("/modules/email/templates/select");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "#0c121a", minHeight: "100vh", color: "#fff", fontSize: 16 }}>
      {dkimVerified === false && (
        <div
          style={{
            width: "1320px",
            maxWidth: "100%",
            margin: "0 auto",
            background: "#451a03",
            border: "2px solid #f97316",
            color: "#fbbf24",
            borderRadius: "10px",
            padding: "10px 18px",
            marginTop: "24px",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          <span>⚠️ DKIM not verified. Emails may not be delivered.</span>
          <button
            onClick={() => router.push("/account")}
            style={{
              background: "#f97316",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "6px",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            Fix now
          </button>
        </div>
      )}

      {dkimVerified === true && (
        <div
          style={{
            width: "1320px",
            maxWidth: "100%",
            margin: "0 auto",
            background: "#064e3b",
            border: "2px solid #10b981",
            color: "#a7f3d0",
            borderRadius: "10px",
            padding: "10px 18px",
            marginTop: "24px",
            marginBottom: "16px",
            textAlign: "center",
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          ✅ Your domain{" "}
          <span style={{ textDecoration: "underline" }}>{dkimDomain || "your domain"}</span>{" "}
          has been verified and is ready to send email.
        </div>
      )}

      {/* Orange header */}
      <div
        style={{
          width: "1320px",
          maxWidth: "100%",
          margin: "0 auto",
          background: "#f59e0b",
          color: "#111",
          padding: "18px 22px",
          borderRadius: "16px",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 48 }}>📢</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 48, fontWeight: 600, lineHeight: 1.05 }}>
              Create an Email Broadcast
            </span>
            <span style={{ fontSize: 18, fontWeight: 500, opacity: 0.9, marginTop: 2 }}>
              Send a one-off email campaigns to your subscribers.
            </span>
          </div>
        </div>

        <Link
          href="/modules/email/broadcast/view"
          style={{
            background: "#111",
            color: "#fff",
            fontSize: 18,
            fontWeight: 600,
            borderRadius: 8,
            padding: "6px 14px",
            textDecoration: "none",
            border: "1px solid #000",
          }}
        >
          ← Back
        </Link>
      </div>

      <div className={styles.main}>
        <section
          className={styles.panel}
          style={{
            background: "#f59e0b",
            color: "#111",
            boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
            width: "1320px",
            maxWidth: "100%",
            margin: "0 auto 40px",
            fontSize: 18,
          }}
        >
          <h1 className={styles.h1} style={{ fontSize: 32 }}>
            {broadcastId ? "Edit Broadcast" : "Create Broadcast"}
          </h1>
          <p className={styles.kicker} style={{ fontSize: 18 }}>
            Set sender, audience, subject, content and send.
          </p>

          {loadError && (
            <p className={styles.error} style={{ marginBottom: 10, fontSize: 16 }}>
              {loadError}
            </p>
          )}

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>Broadcast / Email name</label>
            <input
              className={styles.input}
              value={form.name}
              onChange={onChange("name")}
              onBlur={() => onTouch("name")()}
            />
            {errors.name && touched.name && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.name}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>From name</label>
            <input
              className={styles.input}
              value={form.fromName}
              onChange={onChange("fromName")}
              onBlur={() => onTouch("fromName")()}
            />
            {errors.fromName && touched.fromName && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.fromName}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>From email</label>
            <input
              className={styles.input}
              value={form.fromEmail}
              onChange={onChange("fromEmail")}
              onBlur={() => onTouch("fromEmail")()}
            />
            {errors.fromEmail && touched.fromEmail && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.fromEmail}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>Reply-to</label>
            <input
              className={styles.input}
              value={form.replyTo}
              onChange={onChange("replyTo")}
              onBlur={() => onTouch("replyTo")()}
            />
            {errors.replyTo && touched.replyTo && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.replyTo}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>Audience / Segment</label>
            <select
              className={styles.input}
              value={form.audienceType}
              onChange={onChange("audienceType")}
              onBlur={() => onTouch("audienceType")()}
              style={{ fontSize: 16 }}
            >
              <option value="">-- Select --</option>
              <option value="emails">Specific emails</option>
              <option value="list">Existing list</option>
            </select>

            {form.audienceType === "emails" && (
              <input
                className={styles.input}
                placeholder="Comma-separated emails"
                value={form.audience}
                onChange={onChange("audience")}
                onBlur={() => onTouch("audience")()}
              />
            )}

            {form.audienceType === "list" && (
              <select
                className={styles.input}
                value={form.audience}
                onChange={onChange("audience")}
                onBlur={() => onTouch("audience")()}
                style={{ fontSize: 16 }}
              >
                <option value="">-- Choose list --</option>
                {lists.length === 0 ? (
                  <option disabled>(No lists found)</option>
                ) : (
                  lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))
                )}
              </select>
            )}

            {errors.audienceType && touched.audienceType && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.audienceType}
              </div>
            )}
            {errors.audience && touched.audience && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.audience}
              </div>
            )}
          </div>

          {/* SUBJECT + AI */}
          <div className={styles.field}>
            <label style={{ fontSize: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Subject line</span>
              <button
                type="button"
                onClick={generateSubjectsSingle}
                disabled={aiBusy || busy}
                style={{
                  background: "#111827",
                  color: "#fff",
                  border: "1px solid #000",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontSize: 14,
                  opacity: aiBusy || busy ? 0.7 : 1,
                }}
                title="Generate a subject line using AI"
              >
                {aiBusy ? "Generating..." : "✨ Generate with AI"}
              </button>
            </label>

            <input
              className={styles.input}
              value={form.subject}
              onChange={onChange("subject")}
              onBlur={() => onTouch("subject")()}
            />
            {errors.subject && touched.subject && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.subject}
              </div>
            )}

            {/* AI settings (small + optional) */}
            <div
              style={{
                marginTop: 8,
                background: "#fde68a",
                border: "1px solid #b45309",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                🧠 AI settings (optional)
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  className={styles.input}
                  placeholder="Tone (example: friendly, professional)"
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  style={{ fontSize: 16 }}
                />
                <textarea
                  className={styles.textarea}
                  rows={2}
                  placeholder="Context (optional). Example: This is GR8 RESULT sending a marketing email about a free blueprint."
                  value={aiContext}
                  onChange={(e) => setAiContext(e.target.value)}
                  style={{ fontSize: 16 }}
                />
                {aiLastError ? (
                  <div className={styles.error} style={{ fontSize: 14 }}>
                    {aiLastError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* PREHEADER */}
          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>Preheader (inbox preview text)</label>
            <input
              className={styles.input}
              value={form.preheader}
              onChange={onChange("preheader")}
              onBlur={() => onTouch("preheader")()}
            />
            <div style={{ fontSize: 14, opacity: 0.85, marginTop: 6 }}>
              The preheader is the small preview text shown in the inbox next to the subject.
              We use <b>one preheader</b> for the email — even when A/B subject testing is enabled.
            </div>
            {errors.preheader && touched.preheader && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.preheader}
              </div>
            )}
          </div>

          {/* A/B */}
          <div
            className={styles.field}
            style={{
              background: "#fde68a",
              borderRadius: 10,
              padding: "10px 12px",
              marginBottom: 12,
              border: "1px solid #b45309",
              fontSize: 16,
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={form.abEnabled}
                onChange={toggleAbEnabled}
                style={{ width: 22, height: 22, transform: "scale(1.6)", cursor: "pointer" }}
              />
              Run this as an A/B test on the subject line
            </label>

            <div style={{ fontSize: 16, marginTop: 4, opacity: 0.8 }}>
              We will split your audience and send half Subject Line A and half Subject Line B.
              (Preheader stays the same for both.)
            </div>

            {form.abEnabled && (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <label style={{ fontSize: 16, fontWeight: 700 }}>Subject Line A</label>
                  <button
                    type="button"
                    onClick={generateSubjectsAB}
                    disabled={aiBusy || busy}
                    style={{
                      background: "#111827",
                      color: "#fff",
                      border: "1px solid #000",
                      borderRadius: 8,
                      padding: "6px 12px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontSize: 14,
                      opacity: aiBusy || busy ? 0.7 : 1,
                    }}
                    title="Generate Subject Line A and B using AI"
                  >
                    {aiBusy ? "Generating..." : "✨ Generate A/B with AI"}
                  </button>
                </div>

                <div>
                  <input
                    className={styles.input}
                    value={form.abSubjectA}
                    onChange={onChange("abSubjectA")}
                    onBlur={() => onTouch("abSubjectA")()}
                  />
                  {errors.abSubjectA && touched.abSubjectA && (
                    <div className={styles.error} style={{ fontSize: 16 }}>
                      {errors.abSubjectA}
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: 16, fontWeight: 700 }}>Subject Line B</label>
                  <input
                    className={styles.input}
                    value={form.abSubjectB}
                    onChange={onChange("abSubjectB")}
                    onBlur={() => onTouch("abSubjectB")()}
                  />
                  {errors.abSubjectB && touched.abSubjectB && (
                    <div className={styles.error} style={{ fontSize: 16 }}>
                      {errors.abSubjectB}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>Or select a finished email</label>
            <select
              className={styles.input}
              value={form.savedEmailPath || ""}
              onChange={handleSavedEmailChange}
              style={{ fontSize: 16 }}
            >
              <option value="">-- Type new content or choose a finished email --</option>
              {savedEmailsLoading && <option disabled>Loading finished emails…</option>}
              {!savedEmailsLoading && savedEmails.length === 0 && (
                <option disabled>(No finished emails found)</option>
              )}
              {!savedEmailsLoading &&
                savedEmails.map((email) => (
                  <option key={email.path} value={email.path}>
                    {email.label}
                  </option>
                ))}
            </select>
            {savedEmailsError && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {savedEmailsError}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>Email content</label>

            {!form.savedEmailPath && (
              <textarea
                className={styles.textarea}
                rows={4}
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value, bodyHtml: e.target.value }))
                }
                onBlur={() => onTouch("bodyHtml")()}
                style={{ fontSize: 16 }}
              />
            )}

            <div
              style={{
                marginTop: 10,
                borderRadius: 10,
                border: "1px solid #b45309",
                background: "#fff",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "6px 10px",
                  fontSize: 18,
                  fontWeight: 700,
                  background: "#fbbf24",
                  borderBottom: "1px solid #b45309",
                  color: "#111827",
                }}
              >
                Preview
              </div>
              <div
                style={{
                  padding: 10,
                  maxHeight: 220,
                  minHeight: 80,
                  overflowY: "auto",
                  background: "#f3f4f6",
                }}
              >
                {form.bodyHtml || form.body ? (
                  <div
                    style={{ background: "#ffffff", margin: "0 auto" }}
                    dangerouslySetInnerHTML={{ __html: form.bodyHtml || form.body }}
                  />
                ) : (
                  <div style={{ fontSize: 16, opacity: 0.7, color: "#111827" }}>
                    Type your content above or choose a finished email to see a preview here.
                  </div>
                )}
              </div>
            </div>

            {errors.bodyHtml && touched.bodyHtml && (
              <div className={styles.error} style={{ fontSize: 16 }}>
                {errors.bodyHtml}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label style={{ fontSize: 16 }}>
              <input
                type="checkbox"
                checked={showAI}
                onChange={() => setShowAI((v) => !v)}
                style={{ width: 18, height: 18, marginRight: 6, cursor: "pointer" }}
              />{" "}
              Use AI assistant
            </label>
            {showAI && (
              <textarea
                className={styles.textarea}
                rows={4}
                value={form.outline}
                onChange={onChange("outline")}
                style={{ fontSize: 16 }}
              />
            )}
          </div>

          <div
            className={styles.footer}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginTop: 18,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Send test to:</span>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid #9ca3af",
                    minWidth: 220,
                    fontSize: 16,
                  }}
                />
                <button
                  type="button"
                  onClick={handleSendTest}
                  disabled={busy}
                  style={{
                    background: "#0f766e",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    opacity: busy ? 0.7 : 1,
                    fontSize: 16,
                  }}
                >
                  Send test
                </button>
              </div>

              {/* sandbox toggle */}
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={sandbox}
                  onChange={() => setSandbox((v) => !v)}
                  style={{ width: 22, height: 22, transform: "scale(1.4)", cursor: "pointer" }}
                />
                SendGrid Sandbox (no delivery — use this while you’re hitting limits)
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleSend}
                disabled={busy}
                className={styles.cta}
                style={{
                  background: "#16a34a",
                  borderColor: "#15803d",
                  minWidth: 130,
                  fontSize: 16,
                }}
              >
                {busy ? "Working..." : "Send now"}
              </button>

              <button
                type="button"
                onClick={onContinueToTemplates}
                disabled={busy}
                style={{
                  background: "#111827",
                  color: "#fff",
                  borderRadius: 8,
                  border: "1px solid #000",
                  padding: "8px 14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  minWidth: 210,
                  fontSize: 16,
                }}
              >
                Continue to Templates (optional)
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}



