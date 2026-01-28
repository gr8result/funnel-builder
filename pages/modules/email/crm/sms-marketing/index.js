// FULL REPLACEMENT — FIXES BROKEN ENDPOINT WIRING + REMOVES UNSUPPORTED "LIST/MANUAL CAMPAIGN" PATHS
//
// ✅ Keeps your existing structure + banner
// ✅ Campaign queues into sms_queue via POST /api/smsglobal/launch-sequence (LEAD ONLY — matches your API)
// ✅ Single sends via POST /api/smsglobal/SMSSend (lead_id OR manual to)
// ✅ Emoji picker kept — BIG + stays open until you close it
// ✅ Pulls lead_id from URL (?lead_id=...) and preselects Campaign + Single
// ✅ IMPORTANT: Never sends empty Authorization header (cached tokenRef)
//
// NOTE (the actual fix):
// Your /api/smsglobal/launch-sequence endpoint you pasted ONLY supports audience.type === "lead".
// So this UI now ONLY allows Campaign = Lead.
// (We removed Campaign List/Manual and Single List so it stops throwing errors.)

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
  if (d.length === 10 && d.startsWith("04"))
    return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return raw;
}

function normalizePhoneForSend(raw) {
  const t = s(raw);
  if (!t) return "";
  if (t.startsWith("+")) return `+${digitsOnly(t)}`;
  return digitsOnly(t);
}

const DEFAULT_TEMPLATES = [
  {
    id: "welcome_quick",
    name: "Welcome — Quick",
    text: "Hey, 👋 Thanks for connecting. Reply STOP to opt out.",
  },
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
      <svg
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M7.5 18.2 4 20V6.8C4 5.8 4.8 5 5.8 5H18.2C19.2 5 20 5.8 20 6.8V14.2C20 15.2 19.2 16 18.2 16H9.6L7.5 18.2Z"
          stroke="white"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M7.2 9.2H16.8M7.2 12H14.8"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ✅ BIGGER GLYPHS (but not bigger tiles) + DOES NOT AUTO CLOSE UNLESS ESC / OUTSIDE CLICK / Close BUTTON
function EmojiPicker({ open, onPick, onClose }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    function onDown(e) {
      // if click/tap is outside the picker container, close it
      if (!containerRef.current) return;
      const el = containerRef.current;
      if (!el.contains(e.target)) onClose?.();
    }

    window.addEventListener("keydown", onKey, true);
    // use capture so clicks are detected even if other handlers stop propagation
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 10px)",
        zIndex: 50,
        width: 720, // keep panel width as original
        borderRadius: 16,
        border: "1px solid rgba(255, 255, 255, 0.14)",
        background: "rgba(5,10,20,0.98)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.65)",
        padding: 14,
      }}
    >
      <div
        style={{
          color: "rgba(255,255,255,0.88)",
          fontSize: 18,
          marginBottom: 10,
          fontWeight: 700,
        }}
      >
        Pick emojis (stays open — press Close when done)
      </div>

      {/* keep original grid (many columns) but scale the emoji glyph only */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 12 }}>
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick?.(e)}
            style={{
              height: 64, // original tile height
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.07)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
            aria-label={`emoji ${e}`}
            title={e}
          >
            {/* scale only the emoji glyph so the tile stays the same size; slightly reduced from previous */}
            <span style={{ display: "inline-block", fontSize: 36, transform: "scale(1.5)", lineHeight: 1, transformOrigin: "center" }}>
              {e}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "12px 12px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.16)",
          color: "#fff",
          fontWeight: 900,
          cursor: "pointer",
          fontSize: 16,
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

  const [accessToken, setAccessToken] = useState("");
  const tokenRef = useRef("");

  const [leads, setLeads] = useState([]);

  // Campaign audience (LEAD ONLY to match /api/smsglobal/launch-sequence)
  const [selectedLeadId, setSelectedLeadId] = useState("");

  const [templates] = useState(DEFAULT_TEMPLATES);

  const [steps, setSteps] = useState([
    { templateId: "welcome_quick", delay: 0, unit: "minutes", message: DEFAULT_TEMPLATES[0].text },
    { templateId: "follow_up", delay: 1, unit: "minutes", message: DEFAULT_TEMPLATES[1].text },
    { templateId: "offer_short", delay: 1, unit: "minutes", message: DEFAULT_TEMPLATES[2].text },
  ]);

  const [sendingCampaign, setSendingCampaign] = useState(false);

  // Single audience (lead/manual only)
  const [singleAudienceType, setSingleAudienceType] = useState("lead"); // manual | lead
  const [singleLeadId, setSingleLeadId] = useState("");
  const [singleManualPhone, setSingleManualPhone] = useState("");
  const [singleMessage, setSingleMessage] = useState("");
  const [sendingSingle, setSendingSingle] = useState(false);

  // Emoji picker state
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState({ kind: null, index: null }); // {kind:'step'|'single', index:number|null}

  // --- AUTH HELPERS (NO EMPTY AUTH HEADER EVER) ---
  function requireToken() {
    const t = tokenRef.current || "";
    if (!t) {
      const err = new Error("Not logged in (missing session token). Please refresh and log in again.");
      err.status = 401;
      throw err;
    }
    return t;
  }

  async function apiGet(path) {
    const token = requireToken();
    const r = await fetch(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
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
    const token = requireToken();
    const r = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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

  const leadOptions = useMemo(() => {
    const arr = Array.isArray(leads) ? leads : [];
    return arr.map((l) => {
      const labelParts = [];
      if (s(l?.name)) labelParts.push(s(l.name));
      if (s(l?.email)) labelParts.push(s(l.email));
      const ph = s(l?.phone_number || l?.mobile_phone || l?.phone || l?.mobile);
      if (ph) labelParts.push(ph);
      const label = labelParts.length ? labelParts.join(" — ") : l?.id;
      return { id: l?.id, label };
    });
  }, [leads]);

  // ✅ keep token in sync even if session refreshes
  useEffect(() => {
    let alive = true;

    async function initToken() {
      try {
        const { data } = await supabase.auth.getSession();
        const t = data?.session?.access_token || "";
        if (!alive) return;
        setAccessToken(t);
        tokenRef.current = t;
      } catch {
        if (!alive) return;
        setAccessToken("");
        tokenRef.current = "";
      }
    }

    initToken();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const t = session?.access_token || "";
      setAccessToken(t);
      tokenRef.current = t;
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // ✅ preload lead_id from URL (both campaign + single)
  useEffect(() => {
    const qLead = s(router?.query?.lead_id);
    if (qLead) {
      setSelectedLeadId(qLead);
      setSingleAudienceType("lead");
      setSingleLeadId(qLead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router?.query?.lead_id]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setBannerError("");

      try {
        if (!tokenRef.current) {
          throw new Error("Not logged in (missing session). Please refresh and log in again.");
        }

        const leadRes = await apiGet("/api/crm/leads?limit=50000");
        const leadArr = Array.isArray(leadRes?.leads) ? leadRes.leads : [];

        if (!alive) return;

        setLeads(leadArr);

        const qLead = s(router?.query?.lead_id);

        if (qLead) {
          setSelectedLeadId(qLead);
          setSingleLeadId(qLead);
        } else {
          if (!selectedLeadId && leadArr.length) setSelectedLeadId(leadArr[0].id);
          if (!singleLeadId && leadArr.length) setSingleLeadId(leadArr[0].id);
        }

        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setBannerError(e?.message ? `Failed to load leads: ${e.message}` : "Failed to load leads");
        setLoading(false);
      }
    }

    if (tokenRef.current) load();
    else {
      setLoading(false);
      setBannerError("Not logged in (missing session). Please refresh and log in again.");
    }

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

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

  function openEmojiForStep(i) {
    setEmojiTarget({ kind: "step", index: i });
    setEmojiOpen(true);
  }

  function openEmojiForSingle() {
    setEmojiTarget({ kind: "single", index: null });
    setEmojiOpen(true);
  }

  function handlePickEmoji(e) {
    if (emojiTarget.kind === "step" && typeof emojiTarget.index === "number") {
      const i = emojiTarget.index;
      setSteps((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], message: (next[i]?.message || "") + e };
        return next;
      });
    } else if (emojiTarget.kind === "single") {
      setSingleMessage((m) => (m || "") + e);
    }
    // DO NOT CLOSE
  }

  async function startCampaign() {
    setBannerError("");
    setSendingCampaign(true);

    try {
      requireToken();

      const lead_id = s(selectedLeadId);
      if (!lead_id) throw new Error("Pick a lead.");

      const payload = {
        audience: { type: "lead", lead_id },
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

      setBannerError(`Queued: ${r?.queued ?? 0}`);
    } catch (e) {
      const detail = e?.detail?.detail || e?.detail?.message || "";
      setBannerError(
        e?.message
          ? `Server error: ${e.message}${detail ? ` — ${detail}` : ""}`
          : "Server error"
      );
    } finally {
      setSendingCampaign(false);
    }
  }

  async function sendSingle() {
    setBannerError("");
    setSendingSingle(true);

    try {
      requireToken();

      const msg = s(singleMessage);
      if (!msg) throw new Error("Enter a message.");

      // ✅ correct route is /api/smsglobal/SMSSend
      if (singleAudienceType === "lead") {
        const lead_id = s(singleLeadId);
        if (!lead_id) throw new Error("Pick a lead.");
        const r = await apiPost("/api/smsglobal/SMSSend", { lead_id, message: msg });
        setBannerError(`Sent OK (provider_id: ${r?.provider_id || "-"})`);
        setSingleMessage("");
        return;
      }

      if (singleAudienceType === "manual") {
        const to = normalizePhoneForSend(singleManualPhone);
        if (!to) throw new Error("Enter a phone number.");
        const r = await apiPost("/api/smsglobal/SMSSend", { to, message: msg });
        setBannerError(`Sent OK (provider_id: ${r?.provider_id || "-"})`);
        setSingleMessage("");
        return;
      }

      throw new Error("Invalid single audience type.");
    } catch (e) {
      const detail = e?.detail?.detail || e?.detail?.raw || e?.detail?.message || "";
      setBannerError(
        e?.message
          ? `Server error: ${e.message}${detail ? ` — ${detail}` : ""}`
          : "Server error"
      );
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

            {/* Audience row (LEAD ONLY) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, marginBottom: 6 }}>
                  Select lead
                </div>
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
                          onClick={() => openEmojiForStep(i)}
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
                Leads loaded: <b>{Array.isArray(leads) ? leads.length : 0}</b>
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
            <div style={{ color: "rgb(123, 214, 48)", fontSize: 24, marginBottom: 12 }}>
              Use keypad + templates for quick one-off messages.
            </div>

            {/* Single audience row */}
            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: "rgb(123, 214, 48)", fontSize: 16, marginBottom: 6 }}>Send to</div>
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
                </select>
              </div>

              <div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16, marginBottom: 6 }}>
                  {singleAudienceType === "manual" ? "Phone number" : "Select lead"}
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
              {/* Keypad */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 12,
                  padding: 12,
                  background: "rgba(0,0,0,0.20)",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {["1","2","3","4","5","6","7","8","9","+","0","⌫"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        if (singleAudienceType !== "manual") return;
                        if (k === "⌫") return setSingleManualPhone((p) => (p || "").slice(0, -1));
                        setSingleManualPhone((p) => (p || "") + k);
                      }}
                      style={{
                        padding: "16px 0", // keep original tile padding/height
                        borderRadius: 12,
                        background: "rgba(99,102,241,0.18)",
                        border: "1px solid rgba(99,102,241,0.35)",
                        color: "rgb(123, 214, 48)",
                        fontWeight: 500,
                        cursor: singleAudienceType === "manual" ? "pointer" : "not-allowed",
                        opacity: singleAudienceType === "manual" ? 1 : 0.85,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        // base fontSize reduced so scaled glyph fits cleanly
                        fontSize: 28,
                        lineHeight: "1",
                      }}
                    >
                      {/* scale only the digit glyph; keeps tile size unchanged */}
                      <span style={{ display: "inline-block", transform: "scale(1.9)", transformOrigin: "center", lineHeight: 1 }}>
                        {k}
                      </span>
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
                      onClick={openEmojiForSingle}
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
                      onPick={handlePickEmoji}
                      onClose={() => setEmojiOpen(false)}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 6, color: "rgb(255, 253, 253)", fontSize: 24 }}>SMS message</div>
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