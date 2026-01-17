// /pages/modules/email/crm/sms-marketing/index.js
// FULL REPLACEMENT — Campaign + Single both support Lead dropdown again (no reinventing)
// ✅ Keeps your existing structure + banner
// ✅ Campaign queues into sms_queue (via /api/smsglobal/launch-sequence)
// ✅ Single sends via /api/smsglobal/SMSGlobalSMSSend using lead_id OR manual to
// ✅ Emoji picker kept

import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../../utils/supabase-client";

const CLEAN_FONT =
  "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'";

function s(v) {
  return String(v ?? "").trim();
}

function digitsOnly(v) {
  return s(v).replace(/[^\d]/g, "");
}

function formatPhonePretty(raw) {
  const d = digitsOnly(raw);
  if (!d) return "";
  if (d.length === 10 && d.startsWith("04")) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return raw;
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
}

async function apiGet(path) {
  const token = await getAccessToken();
  const r = await fetch(path, {
    method: "GET",
    headers: { Authorization: token ? `Bearer ${token}` : "" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    const err = new Error(j?.error || "Request failed");
    err.detail = j?.detail || null;
    err.status = r.status;
    throw err;
  }
  return j;
}

async function apiPost(path, body) {
  const token = await getAccessToken();
  const r = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    const msg = j?.error || "Request failed";
    const err = new Error(msg);
    err.detail = j?.detail || j || null;
    err.status = r.status;
    throw err;
  }
  return j;
}

const DEFAULT_TEMPLATES = [
  { id: "welcome_quick", name: "Welcome — Quick", text: "Hey, 👋 Thanks for connecting. Reply STOP to opt out." },
  {
    id: "follow_up",
    name: "Follow-up",
    text: "Hi — are you keen on our offer? Need help choosing the best strategy? Reply YES or reply STOP to opt out.",
  },
  {
    id: "offer_short",
    name: "Offer — Short pitch",
    text: "Hey, quick one: want us to help set up your system so it runs on autopilot? Reply HELP. Reply STOP to opt out.",
  },
];

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","🙂","😉","😍","😘","😎","🤩","🤔","😴",
  "👍","👎","👏","🙏","💪","🔥","✨","⭐","✅","❌","⚠️","📞","💬","📩","📅","⏰",
  "🎉","🎯","💡","📌","🧠","🫶","❤️","💛","💚","💙","💜","🖤","🤍",
];

function BannerIcon({ size = 48 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        background: "rgba(255,255,255,0.18)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
      }}
      aria-hidden="true"
    >
      <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" fill="none">
        <path
          d="M7.5 18.2 4 20V6.8C4 5.8 4.8 5 5.8 5H18.2C19.2 5 20 5.8 20 6.8V14.2C20 15.2 19.2 16 18.2 16H9.6L7.5 18.2Z"
          stroke="white"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M7.2 9.2H16.8M7.2 12H14.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function EmojiPicker({ open, anchorRef, onPick, onClose }) {
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    function onDown(e) {
      const p = pickerRef.current;
      const a = anchorRef?.current;
      const t = e.target;
      if (p && p.contains(t)) return;
      if (a && a.contains(t)) return;
      onClose?.();
    }

    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={pickerRef}
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 8px)",
        zIndex: 50,
        width: 320,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(5,10,20,0.96)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        padding: 10,
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 14, marginBottom: 8, fontWeight: 600 }}>
        Pick an emoji
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick?.(e)}
            style={{
              height: 34,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.06)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: "34px",
            }}
            aria-label={`emoji ${e}`}
            title={e}
          >
            {e}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "#fff",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}

export default function SmsMarketingPage() {
  const router = useRouter();

  const [bannerError, setBannerError] = useState("");
  const [loading, setLoading] = useState(true);

  const [leads, setLeads] = useState([]);
  const [leadLists, setLeadLists] = useState([]);

  // Campaign audience
  const [audienceType, setAudienceType] = useState("lead"); // manual | lead | list
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedListId, setSelectedListId] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const [templates] = useState(DEFAULT_TEMPLATES);

  const [steps, setSteps] = useState([
    { templateId: "welcome_quick", delay: 0, unit: "minutes", message: DEFAULT_TEMPLATES[0].text },
    { templateId: "follow_up", delay: 1, unit: "minutes", message: DEFAULT_TEMPLATES[1].text },
    { templateId: "offer_short", delay: 1, unit: "minutes", message: DEFAULT_TEMPLATES[2].text },
  ]);

  const [sendingCampaign, setSendingCampaign] = useState(false);

  // Single audience (copied logic from campaign; no reinvention)
  const [singleAudienceType, setSingleAudienceType] = useState("lead"); // manual | lead | list
  const [singleLeadId, setSingleLeadId] = useState("");
  const [singleListId, setSingleListId] = useState("");
  const [singleManualPhone, setSingleManualPhone] = useState("");

  const [singleMessage, setSingleMessage] = useState("");
  const [sendingSingle, setSendingSingle] = useState(false);

  // Emoji picker state
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState({ kind: null, index: null }); // {kind:'step'|'single', index:number|null}
  const emojiBtnRef = useRef(null);

  const leadOptions = useMemo(() => {
    const arr = Array.isArray(leads) ? leads : [];
    return arr.map((l) => {
      const labelParts = [];
      if (s(l?.name)) labelParts.push(s(l.name));
      if (s(l?.email)) labelParts.push(s(l.email));
      const ph = s(l?.mobile || l?.phone);
      if (ph) labelParts.push(ph);
      const label = labelParts.length ? labelParts.join(" — ") : l?.id;
      return { id: l?.id, label };
    });
  }, [leads]);

  const listOptions = useMemo(() => {
    const arr = Array.isArray(leadLists) ? leadLists : [];
    return arr.map((x) => ({ id: x?.id, name: x?.name || x?.id }));
  }, [leadLists]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setBannerError("");

      try {
        const token = await getAccessToken();
        if (!token) {
          if (!alive) return;
          setBannerError("Not logged in (missing session).");
          setLoading(false);
          return;
        }

        const leadRes = await apiGet("/api/crm/leads?limit=50000");
        const leadArr = Array.isArray(leadRes?.leads) ? leadRes.leads : [];

        const listRes = await apiGet("/api/crm/lead-lists");
        const listArr = Array.isArray(listRes?.lists) ? listRes.lists : [];

        if (!alive) return;

        setLeads(leadArr);
        setLeadLists(listArr);

        // Defaults for both campaign + single
        if (!selectedLeadId && leadArr.length) setSelectedLeadId(leadArr[0].id);
        if (!selectedListId && listArr.length) setSelectedListId(listArr[0].id);

        if (!singleLeadId && leadArr.length) setSingleLeadId(leadArr[0].id);
        if (!singleListId && listArr.length) setSingleListId(listArr[0].id);

        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setBannerError(e?.message ? `Failed to load leads: ${e.message}` : "Failed to load leads");
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setStep(i, patch) {
    setSteps((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function applyTemplateToStep(i, templateId) {
    const t = templates.find((x) => x.id === templateId);
    setStep(i, { templateId, message: t?.text || "" });
  }

  function openEmojiForStep(i, btnEl) {
    emojiBtnRef.current = btnEl;
    setEmojiTarget({ kind: "step", index: i });
    setEmojiOpen(true);
  }

  function openEmojiForSingle(btnEl) {
    emojiBtnRef.current = btnEl;
    setEmojiTarget({ kind: "single", index: null });
    setEmojiOpen(true);
  }

  function handlePickEmoji(e) {
    if (emojiTarget.kind === "step" && typeof emojiTarget.index === "number") {
      const i = emojiTarget.index;
      setStep(i, { message: (steps[i]?.message || "") + e });
    } else if (emojiTarget.kind === "single") {
      setSingleMessage((m) => (m || "") + e);
    }
    setEmojiOpen(false);
  }

  async function startCampaign() {
    setBannerError("");
    setSendingCampaign(true);

    try {
      let audience = { type: audienceType };

      if (audienceType === "manual") {
        const phone = s(manualPhone);
        if (!phone) throw new Error("Enter a phone number for manual send.");
        audience.phone = phone;
      } else if (audienceType === "lead") {
        const lead_id = s(selectedLeadId);
        if (!lead_id) throw new Error("Pick a lead.");
        audience.lead_id = lead_id;
      } else if (audienceType === "list") {
        const list_id = s(selectedListId);
        if (!list_id) throw new Error("Pick a list.");
        audience.list_id = list_id;
      } else {
        throw new Error("Invalid audience type.");
      }

      const payload = {
        audience,
        steps: steps
          .map((st) => ({
            delay: Number(st.delay || 0),
            unit: s(st.unit || "minutes"),
            message: s(st.message),
          }))
          .filter((x) => x.message)
          .slice(0, 3),
      };

      const r = await apiPost("/api/smsglobal/launch-sequence", payload);

      setBannerError(`Queued: ${r?.queued ?? 0} (recipients: ${r?.recipients ?? 0}, steps: ${r?.steps ?? 0})`);
    } catch (e) {
      const detail = e?.detail?.detail || e?.detail?.message || "";
      setBannerError(e?.message ? `Server error: ${e.message}${detail ? ` — ${detail}` : ""}` : "Server error");
    } finally {
      setSendingCampaign(false);
    }
  }

  async function sendSingle() {
    setBannerError("");
    setSendingSingle(true);

    try {
      const msg = s(singleMessage);
      if (!msg) throw new Error("Enter a message.");

      // Same audience choices as campaign (copied, not reinvented)
      if (singleAudienceType === "lead") {
        const lead_id = s(singleLeadId);
        if (!lead_id) throw new Error("Pick a lead.");
        const r = await apiPost("/api/smsglobal/SMSGlobalSMSSend", { lead_id, message: msg });
        setBannerError(`Sent OK (provider_id: ${r?.provider_id || "-"})`);
        setSingleMessage("");
        return;
      }

      if (singleAudienceType === "manual") {
        const to = s(singleManualPhone);
        if (!to) throw new Error("Enter a phone number.");
        const r = await apiPost("/api/smsglobal/SMSGlobalSMSSend", { to, message: msg });
        setBannerError(`Sent OK (provider_id: ${r?.provider_id || "-"})`);
        setSingleMessage("");
        return;
      }

      // List for single = send step 1 to list immediately (uses launch-sequence with 1 step)
      if (singleAudienceType === "list") {
        const list_id = s(singleListId);
        if (!list_id) throw new Error("Pick a list.");
        const r = await apiPost("/api/smsglobal/launch-sequence", {
          audience: { type: "list", list_id },
          steps: [{ delay: 0, unit: "minutes", message: msg }],
        });
        setBannerError(`Queued single-to-list: ${r?.queued ?? 0}`);
        setSingleMessage("");
        return;
      }

      throw new Error("Invalid single audience type.");
    } catch (e) {
      const detail =
        e?.detail?.detail ||
        e?.detail?.smsglobal_http ||
        e?.detail?.message ||
        "";
      setBannerError(e?.message ? `Server error: ${e.message}${detail ? ` — ${detail}` : ""}` : "Server error");
    } finally {
      setSendingSingle(false);
    }
  }

  return (
    <>
      <Head>
        <title>SMS Marketing — GR8 RESULT</title>
      </Head>

      <div style={{ fontFamily: CLEAN_FONT, padding: 18 }}>
        {/* Banner */}
        <div
          style={{
            maxWidth: 1320,
            margin: "0 auto 14px auto",
            padding: "16px 18px",
            borderRadius: 12,
            background: "linear-gradient(90deg, rgba(12,148,149,0.95), rgba(9,113,126,0.95))",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BannerIcon size={48} />
            <div>
              <div style={{ fontSize: 48, fontWeight: 500, lineHeight: 1.05 }}>SMS Marketing</div>
              <div style={{ opacity: 0.9, fontSize: 18 }}>
                Templates + single SMS + scheduled SMS campaigns (1–3 steps).
              </div>
            </div>
          </div>

          <button
            onClick={() => router.push("/modules/email/crm")}
            style={{
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.18)",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 999,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            ← Back to CRM
          </button>
        </div>

        {/* Error bar */}
        {(bannerError || loading) && (
          <div
            style={{
              maxWidth: 1320,
              margin: "0 auto 10px auto",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(244,63,94,0.55)",
              background: "rgba(244,63,94,0.10)",
              color: "#ffd6dd",
              fontWeight: 500,
            }}
          >
            {loading ? "Loading…" : bannerError}
          </div>
        )}

        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          {/* Scheduled campaign */}
          <div
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 12px 34px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ color: "#facc15", fontWeight: 600, fontSize: 24, marginBottom: 4 }}>
              SMS Campaign (scheduled)
            </div>
            <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 16, marginBottom: 12 }}>
              Queue up to 3 SMS messages. Delays are “since previous step”.
            </div>

            {/* Audience row */}
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, marginBottom: 6 }}>Audience</div>
                <select
                  className="gr8Select"
                  value={audienceType}
                  onChange={(e) => setAudienceType(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontWeight: 500,
                  }}
                >
                  <option value="manual">Send to one number (manual)</option>
                  <option value="lead">Send to one lead (pick)</option>
                  <option value="list">Send to a list</option>
                </select>
              </div>

              <div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, marginBottom: 6 }}>
                  {audienceType === "manual" ? "Phone number" : audienceType === "list" ? "Lead list" : "Select lead"}
                </div>

                {audienceType === "manual" ? (
                  <input
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="0417… or +61417…"
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontWeight: 500,
                    }}
                  />
                ) : audienceType === "list" ? (
                  <select
                    className="gr8Select"
                    value={selectedListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontWeight: 500,
                    }}
                  >
                    {listOptions.length ? (
                      listOptions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))
                    ) : (
                      <option value="">(No lists loaded for this user)</option>
                    )}
                  </select>
                ) : (
                  <select
                    className="gr8Select"
                    value={selectedLeadId}
                    onChange={(e) => setSelectedLeadId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontWeight: 500,
                    }}
                  >
                    {leadOptions.length ? (
                      leadOptions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))
                    ) : (
                      <option value="">(No leads loaded for this user)</option>
                    )}
                  </select>
                )}
              </div>
            </div>

            {/* Steps */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid rgba(59,130,246,0.35)",
                    background: "rgba(0,0,0,0.25)",
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#facc15", fontWeight: 600, marginBottom: 2 }}>Step {i + 1}</div>
                  <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 16, marginBottom: 10 }}>
                    {i === 0 ? "Delay before step 1. Set 0 to send immediately." : `Delay after step ${i}.`}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 92px 130px", gap: 8 }}>
                    <div>
                      <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 16, marginBottom: 6 }}>Template</div>
                      <select
                        className="gr8Select"
                        value={steps[i]?.templateId || ""}
                        onChange={(e) => applyTemplateToStep(i, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: "rgba(0,0,0,0.55)",
                          color: "#fff",
                          border: "1px solid rgba(255,255,255,0.12)",
                          fontWeight: 500,
                        }}
                      >
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 16, marginBottom: 6 }}>Delay</div>
                      <input
                        value={String(steps[i]?.delay ?? 0)}
                        onChange={(e) => setStep(i, { delay: Number(e.target.value || 0) })}
                        type="number"
                        min="0"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: "rgba(0,0,0,0.55)",
                          color: "#fff",
                          border: "1px solid rgba(255,255,255,0.12)",
                          fontWeight: 600,
                        }}
                      />
                    </div>

                    <div>
                      <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 16, marginBottom: 6 }}>Unit</div>
                      <select
                        className="gr8Select"
                        value={steps[i]?.unit || "minutes"}
                        onChange={(e) => setStep(i, { unit: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: "rgba(0,0,0,0.55)",
                          color: "#fff",
                          border: "1px solid rgba(255,255,255,0.12)",
                          fontWeight: 600,
                        }}
                      >
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 16 }}>Message</div>

                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          onClick={(ev) => openEmojiForStep(i, ev.currentTarget)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 10,
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Show emojis
                        </button>

                        <EmojiPicker
                          open={emojiOpen && emojiTarget.kind === "step" && emojiTarget.index === i}
                          anchorRef={emojiBtnRef}
                          onPick={handlePickEmoji}
                          onClose={() => setEmojiOpen(false)}
                        />
                      </div>
                    </div>

                    <textarea
                      value={steps[i]?.message || ""}
                      onChange={(e) => setStep(i, { message: e.target.value })}
                      rows={3}
                      style={{
                        width: "100%",
                        marginTop: 6,
                        padding: "10px 10px",
                        borderRadius: 12,
                        background: "rgba(0,0,0,0.55)",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.12)",
                        fontSize: 16,
                        fontWeight: 600,
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={startCampaign}
                disabled={sendingCampaign}
                style={{
                  padding: "9px 12px",
                  borderRadius: 10,
                  background: "rgba(34,197,94,0.18)",
                  border: "1px solid rgba(34,197,94,0.35)",
                  color: "#d7ffe6",
                  fontWeight: 600,
                  cursor: sendingCampaign ? "not-allowed" : "pointer",
                }}
              >
                {sendingCampaign ? "Queuing…" : "Start SMS campaign"}
              </button>

              <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 16 }}>
                Leads loaded: <b>{Array.isArray(leads) ? leads.length : 0}</b> • Lists loaded:{" "}
                <b>{Array.isArray(leadLists) ? leadLists.length : 0}</b>
              </div>
            </div>
          </div>

          {/* Single SMS */}
          <div
            style={{
              marginTop: 14,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 12px 34px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ color: "#facc15", fontWeight: 600, fontSize: 18, marginBottom: 4 }}>Single SMS</div>
            <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 16, marginBottom: 12 }}>
              Use keypad + templates for quick one-off messages.
            </div>

            {/* Single audience row (copied concept from campaign) */}
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, marginBottom: 6 }}>Send to</div>
                <select
                  className="gr8Select"
                  value={singleAudienceType}
                  onChange={(e) => setSingleAudienceType(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontWeight: 500,
                  }}
                >
                  <option value="lead">A lead (pick)</option>
                  <option value="manual">One number (manual)</option>
                  <option value="list">A list (queues 1 step)</option>
                </select>
              </div>

              <div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, marginBottom: 6 }}>
                  {singleAudienceType === "manual"
                    ? "Phone number"
                    : singleAudienceType === "list"
                    ? "Lead list"
                    : "Select lead"}
                </div>

                {singleAudienceType === "manual" ? (
                  <input
                    value={formatPhonePretty(singleManualPhone)}
                    onChange={(e) => setSingleManualPhone(e.target.value)}
                    placeholder="0417… or +61417…"
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontWeight: 600,
                    }}
                  />
                ) : singleAudienceType === "list" ? (
                  <select
                    className="gr8Select"
                    value={singleListId}
                    onChange={(e) => setSingleListId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontWeight: 500,
                    }}
                  >
                    {listOptions.length ? (
                      listOptions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))
                    ) : (
                      <option value="">(No lists loaded for this user)</option>
                    )}
                  </select>
                ) : (
                  <select
                    className="gr8Select"
                    value={singleLeadId}
                    onChange={(e) => setSingleLeadId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontWeight: 500,
                    }}
                  >
                    {leadOptions.length ? (
                      leadOptions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))
                    ) : (
                      <option value="">(No leads loaded for this user)</option>
                    )}
                  </select>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
              {/* Keypad (only really useful for manual mode; still available) */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(0,0,0,0.20)",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        if (singleAudienceType !== "manual") return;
                        if (k === "⌫") return setSingleManualPhone((p) => (p || "").slice(0, -1));
                        setSingleManualPhone((p) => (p || "") + k);
                      }}
                      style={{
                        padding: "16px 0",
                        borderRadius: 12,
                        background: "rgba(99,102,241,0.18)",
                        border: "1px solid rgba(99,102,241,0.35)",
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: 26,
                        cursor: singleAudienceType === "manual" ? "pointer" : "not-allowed",
                        opacity: singleAudienceType === "manual" ? 1 : 0.35,
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setSingleManualPhone("")}
                  disabled={singleAudienceType !== "manual"}
                  style={{
                    width: "100%",
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: singleAudienceType === "manual" ? "pointer" : "not-allowed",
                    opacity: singleAudienceType === "manual" ? 1 : 0.35,
                  }}
                >
                  Clear
                </button>
              </div>

              {/* Message + buttons */}
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <button
                    onClick={sendSingle}
                    disabled={sendingSingle}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(34,197,94,0.18)",
                      border: "1px solid rgba(34,197,94,0.35)",
                      color: "#d7ffe6",
                      fontWeight: 700,
                      cursor: sendingSingle ? "not-allowed" : "pointer",
                    }}
                  >
                    {sendingSingle ? "Sending…" : "Send SMS"}
                  </button>

                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={(ev) => openEmojiForSingle(ev.currentTarget)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.14)",
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Show emojis
                    </button>

                    <EmojiPicker
                      open={emojiOpen && emojiTarget.kind === "single"}
                      anchorRef={emojiBtnRef}
                      onPick={handlePickEmoji}
                      onClose={() => setEmojiOpen(false)}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 6, color: "rgba(255,255,255,0.70)", fontSize: 16 }}>SMS message</div>
                <textarea
                  value={singleMessage}
                  onChange={(e) => setSingleMessage(e.target.value)}
                  placeholder="Type message…"
                  rows={4}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontSize: 16,
                    fontWeight: 600,
                    resize: "vertical",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <style jsx global>{`
          .gr8Select option {
            background: #0b1220;
            color: #ffffff;
          }
          .gr8Select optgroup {
            background: #0b1220;
            color: #ffffff;
          }
        `}</style>
      </div>
    </>
  );
}
