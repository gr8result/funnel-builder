// /pages/modules/email/crm/sms-marketing/index.js
// FULL REPLACEMENT — SIMPLE CAMPAIGN UI + FIX CONTACTS LOADING
//
// ✅ Keeps your exact UI/layout/styles
// ✅ FIX: loads FULL leads + lead lists for the logged-in user (via Bearer token + server APIs)
// ✅ FIX: campaign queue now sends Bearer token + correct audience.type mapping for /api/smsglobal/launch-sequence
// ✅ NO format changes — ONLY makes it work

import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../../../utils/supabase-client";

const CLEAN_FONT =
  'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"';

const PRESETS = [
  {
    key: "welcome_quick",
    name: "Welcome — Quick hello",
    message: "Hey, 👋 Thanks for connecting. Reply STOP to opt out.",
  },
  {
    key: "follow_up",
    name: "Follow-up",
    message:
      "Hi — are you keen on our offer? Need help choosing the best strategy? Reply YES or reply STOP to opt out.",
  },
  {
    key: "offer_short",
    name: "Offer — Short pitch",
    message:
      "Hey, quick one: want us to help set up your system so it runs on autopilot? Reply HELP. Reply STOP to opt out.",
  },
];

const EMOJIS = [
  "😀","😁","😂","🤣","😊","😍","😘","😎","🤝","🙏","👏","💪","🔥","✨","⭐","✅","⚡",
  "💡","📣","📩","📲","🧠","🎯","🚀","💰","📈","🛒","🗓️","📞","📌","🔗","❤️","🎉",
];

function s(v) {
  return String(v ?? "").trim();
}

function normalizePhone(v) {
  const s0 = String(v || "").trim();
  if (!s0) return "";
  let x = s0.replace(/[^\d+]/g, "");

  if (x.startsWith("+")) return x;
  if (x.startsWith("0") && x.length >= 9) return "+61" + x.slice(1);
  if (x.startsWith("61")) return "+" + x;
  return x;
}

function sanitizeAndApplyTokens(msg, brand, link) {
  let out = String(msg || "");

  out = out.replace(/{{\s*brand\s*}}/gi, "{brand}");
  out = out.replace(/{{\s*link\s*}}/gi, "{link}");
  out = out.replaceAll("{{", "{").replaceAll("}}", "}");

  out = out.replaceAll("{brand}", String(brand || ""));
  out = out.replaceAll("{link}", String(link || ""));

  return out;
}

function getPresetMessage(key, fallback) {
  const p = PRESETS.find((x) => x.key === key);
  return p ? p.message : fallback || "";
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return { ok: true, json: JSON.parse(text), text };
  } catch {
    return { ok: false, json: null, text };
  }
}

function digitsOnly(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function insertAtCursor(textareaEl, currentValue, insertText) {
  if (!textareaEl) return currentValue + insertText;

  const start = textareaEl.selectionStart ?? currentValue.length;
  const end = textareaEl.selectionEnd ?? currentValue.length;

  const next = currentValue.slice(0, start) + insertText + currentValue.slice(end);

  requestAnimationFrame(() => {
    try {
      textareaEl.focus();
      const pos = start + insertText.length;
      textareaEl.setSelectionRange(pos, pos);
    } catch {}
  });

  return next;
}

function bestLeadName(l) {
  const name =
    s(l?.name) ||
    s([l?.first_name, l?.last_name].filter(Boolean).join(" ")) ||
    s(l?.email) ||
    "";
  return name || "(Unnamed)";
}

function pickLeadPhone(l) {
  const p1 = normalizePhone(l?.mobile);
  const p2 = normalizePhone(l?.phone);
  return p1 || p2 || "";
}

async function getAccessTokenOrNull() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function apiGet(path, token) {
  const resp = await fetch(path, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const parsed = await safeJson(resp);
  return { resp, parsed };
}

export default function SmsMarketingIndex() {
  const [userId, setUserId] = useState(null);

  // UI mode
  const [audienceType, setAudienceType] = useState("list"); // list | single_lead | single_number

  // Lists
  const [leadLists, setLeadLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState("");

  // Leads (for single lead)
  const [leads, setLeads] = useState([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");

  // Manual phone (for single number)
  const [singlePhone, setSinglePhone] = useState("");

  // Hidden tokens (not shown to users)
  const [brandToken, setBrandToken] = useState("GR8 RESULT");
  const [linkToken, setLinkToken] = useState("");

  const [banner, setBanner] = useState({ type: "", msg: "" });

  const [s1, setS1] = useState({
    template: "welcome_quick",
    delay: 0,
    unit: "hours",
    message: getPresetMessage("welcome_quick"),
  });
  const [s2, setS2] = useState({
    template: "follow_up",
    delay: 1,
    unit: "minutes",
    message: getPresetMessage("follow_up"),
  });
  const [s3, setS3] = useState({
    template: "offer_short",
    delay: 1,
    unit: "minutes",
    message: getPresetMessage("offer_short"),
  });

  const [emojiTarget, setEmojiTarget] = useState(null); // "s1" | "s2" | "s3" | "single"
  const s1Ref = useRef(null);
  const s2Ref = useRef(null);
  const s3Ref = useRef(null);
  const singleMsgRef = useRef(null);

  // Single SMS
  const [singleTo, setSingleTo] = useState("");
  const [singleText, setSingleText] = useState("");
  const [singleStatus, setSingleStatus] = useState("");

  useEffect(() => {
    (async () => {
      try {
        if (typeof window !== "undefined") {
          setLinkToken(window.location?.origin || "");
        }

        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id || null;
        setUserId(uid);

        const token = data?.session?.access_token || null;
        if (!token) {
          setBanner({ type: "error", msg: "Missing Bearer token" });
          return;
        }

        // Lead lists (server-side, scoped)
        const listsRes = await apiGet("/api/crm/lead-lists", token);
        const listsJson = listsRes.parsed.json;

        if (!listsRes.resp.ok || !listsJson?.ok) {
          setBanner({
            type: "error",
            msg: listsJson?.error || listsJson?.detail || listsRes.parsed.text || "Failed to load lists",
          });
        } else {
          const lists = Array.isArray(listsJson.lists) ? listsJson.lists : [];
          setLeadLists(lists);
          setSelectedListId(lists?.[0]?.id || "");
        }

        // Leads (server-side, scoped) — FULL LIST for user_id
        const leadsRes = await apiGet("/api/crm/leads", token);
        const leadsJson = leadsRes.parsed.json;

        if (!leadsRes.resp.ok || !leadsJson?.ok) {
          setBanner({
            type: "error",
            msg: leadsJson?.error || leadsJson?.detail || leadsRes.parsed.text || "Failed to load leads",
          });
          setLeads([]);
          setSelectedLeadId("");
        } else {
          const allLeads = Array.isArray(leadsJson.leads) ? leadsJson.leads : [];
          setLeads(allLeads);
          setSelectedLeadId(allLeads?.[0]?.id || "");
        }
      } catch (e) {
        setBanner({ type: "error", msg: String(e?.message || e || "Server error") });
      }
    })();
  }, []);

  const stepsPayload = useMemo(() => {
    return [
      {
        delay: Number(s1.delay || 0),
        unit: String(s1.unit || "minutes"),
        message: sanitizeAndApplyTokens(s1.message, brandToken, linkToken),
      },
      {
        delay: Number(s2.delay || 0),
        unit: String(s2.unit || "minutes"),
        message: sanitizeAndApplyTokens(s2.message, brandToken, linkToken),
      },
      {
        delay: Number(s3.delay || 0),
        unit: String(s3.unit || "minutes"),
        message: sanitizeAndApplyTokens(s3.message, brandToken, linkToken),
      },
    ].filter((x) => String(x.message || "").trim());
  }, [s1, s2, s3, brandToken, linkToken]);

  function show(type, msg) {
    setBanner({ type, msg: String(msg || "") });
  }
  function clearBanner() {
    setBanner({ type: "", msg: "" });
  }

  function setStepTemplate(stepSetter, stepObj, templateKey) {
    stepSetter({
      ...stepObj,
      template: templateKey,
      message: getPresetMessage(templateKey, stepObj.message),
    });
  }

  function onPickEmoji(emoji) {
    if (!emojiTarget) return;

    if (emojiTarget === "s1") {
      const next = insertAtCursor(s1Ref.current, s1.message, emoji);
      setS1({ ...s1, message: next });
    } else if (emojiTarget === "s2") {
      const next = insertAtCursor(s2Ref.current, s2.message, emoji);
      setS2({ ...s2, message: next });
    } else if (emojiTarget === "s3") {
      const next = insertAtCursor(s3Ref.current, s3.message, emoji);
      setS3({ ...s3, message: next });
    } else if (emojiTarget === "single") {
      const next = insertAtCursor(singleMsgRef.current, singleText, emoji);
      setSingleText(next);
    }
  }

  function resolveAudienceForApi() {
    // MUST match /api/smsglobal/launch-sequence.js:
    // audience.type: manual | lead | list
    if (audienceType === "list") {
      return { type: "list", list_id: selectedListId };
    }

    if (audienceType === "single_lead") {
      return { type: "lead", lead_id: selectedLeadId };
    }

    // single_number
    return { type: "manual", phone: normalizePhone(singlePhone) };
  }

  async function startCampaign() {
    clearBanner();

    try {
      const token = await getAccessTokenOrNull();
      if (!token) return show("error", "Missing Bearer token");

      const audience = resolveAudienceForApi();

      if (audienceType === "list" && !selectedListId) {
        return show("error", "Pick a list.");
      }
      if (audienceType === "single_lead" && !selectedLeadId) {
        return show("error", "Pick a lead.");
      }
      if (audienceType === "single_number" && !audience.phone) {
        return show("error", "Missing phone number (type a number).");
      }
      if (!stepsPayload?.length) {
        return show("error", "No steps to queue (messages are empty).");
      }

      const resp = await fetch("/api/smsglobal/launch-sequence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          // server ignores user_id (it derives from token) — keep payload stable
          user_id: userId || null,
          audience,
          tokens: { brand: brandToken, link: linkToken },
          steps: stepsPayload,
        }),
      });

      const parsed = await safeJson(resp);
      const data = parsed.json;

      if (!resp.ok || !data?.ok) {
        return show(
          "error",
          data?.error || data?.detail || parsed.text || "Failed to queue campaign."
        );
      }

      show("success", `Campaign queued. queued=${data.queued}`);
    } catch (e) {
      show("error", String(e?.message || e));
    }
  }

  async function sendSingle() {
    setSingleStatus("");

    try {
      const to = normalizePhone(singleTo);
      const msg = sanitizeAndApplyTokens(singleText, brandToken, linkToken);

      if (!to) return setSingleStatus("Missing phone number.");
      if (!msg.trim()) return setSingleStatus("Message is empty.");

      const resp = await fetch("/api/smsglobal/SMSGlobalSMSSend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message: msg }),
      });

      const parsed = await safeJson(resp);
      const data = parsed.json;

      if (!resp.ok || !data?.ok) {
        const err = data?.error || data?.detail || parsed.text || "Send failed.";
        return setSingleStatus(err);
      }

      setSingleStatus("Sent.");
      setSingleTo("");
      setSingleText("");
    } catch (e) {
      setSingleStatus(String(e?.message || e));
    }
  }

  function pressKey(k) {
    const cur = String(singleTo || "");
    if (k === "clear") return setSingleTo("");
    if (k === "bksp") return setSingleTo(cur.slice(0, -1));
    if (k === "+") {
      if (cur.startsWith("+")) return;
      return setSingleTo("+" + digitsOnly(cur));
    }
    setSingleTo(cur + String(k));
  }

  const optStyle = styles.option;

  return (
    <main style={{ minHeight: "100vh" }}>
      <Head>
        <title>SMS Marketing</title>
      </Head>

      <style jsx global>{`
        .gr8KeypadBtn {
          font-size: 44px !important;
          line-height: 1 !important;
        }
        .gr8KeypadClear {
          font-size: 30px !important;
          line-height: 1 !important;
        }
        .gr8EmojiBtn {
          font-size: 34px !important;
          line-height: 1 !important;
        }
      `}</style>

      <div style={styles.bannerOuter}>
        <div style={styles.bannerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.bannerIcon}>💬</div>
            <div>
              <div style={styles.bannerTitle}>SMS Marketing</div>
              <div style={styles.bannerSub}>
                Templates + single SMS + scheduled SMS campaigns (1–3 steps).
              </div>
            </div>
          </div>

          <button style={styles.btnPill} onClick={() => history.back()}>
            ← Back to CRM
          </button>
        </div>
      </div>

      <div style={styles.wrap}>
        {banner.msg ? (
          <div
            style={{
              ...styles.notice,
              borderColor:
                banner.type === "error"
                  ? "rgba(244,63,94,0.45)"
                  : "rgba(34,197,94,0.35)",
              background:
                banner.type === "error"
                  ? "rgba(244,63,94,0.10)"
                  : "rgba(34,197,94,0.10)",
            }}
          >
            <div style={{ color: "white", fontWeight: 700 }}>{banner.msg}</div>
          </div>
        ) : null}

        {/* Campaign */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>SMS Campaign (scheduled)</div>
          <div style={styles.cardSub}>Queue up to 3 SMS messages. Delays are “since previous step”.</div>

          <div style={styles.rowTop}>
            <div style={{ minWidth: 260 }}>
              <div style={styles.label}>Audience</div>
              <select
                style={styles.select}
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value)}
              >
                <option style={optStyle} value="list">Send to a list</option>
                <option style={optStyle} value="single_lead">Send to one lead (pick)</option>
                <option style={optStyle} value="single_number">Send to one number (manual)</option>
              </select>
            </div>

            {/* LIST */}
            {audienceType === "list" ? (
              <div style={{ flex: 1, minWidth: 360 }}>
                <div style={styles.label}>Lead list</div>
                <select
                  style={styles.select}
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                >
                  {leadLists?.length ? (
                    leadLists.map((l) => (
                      <option style={optStyle} key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))
                  ) : (
                    <option style={optStyle} value="">
                      (No lists loaded for this user)
                    </option>
                  )}
                </select>
              </div>
            ) : null}

            {/* SINGLE LEAD */}
            {audienceType === "single_lead" ? (
              <div style={{ flex: 1, minWidth: 520 }}>
                <div style={styles.label}>Select lead</div>
                <select
                  style={styles.select}
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                >
                  {leads?.length ? (
                    leads.map((l) => {
                      const nm = bestLeadName(l);
                      const ph = pickLeadPhone(l);
                      return (
                        <option style={optStyle} key={l.id} value={l.id}>
                          {nm}{ph ? ` — ${ph}` : " — (no phone)"}
                        </option>
                      );
                    })
                  ) : (
                    <option style={optStyle} value="">
                      (No leads loaded for this user)
                    </option>
                  )}
                </select>
              </div>
            ) : null}

            {/* SINGLE NUMBER */}
            {audienceType === "single_number" ? (
              <div style={{ minWidth: 260 }}>
                <div style={styles.label}>Phone number</div>
                <input
                  style={styles.input}
                  value={singlePhone}
                  onChange={(e) => setSinglePhone(e.target.value)}
                  placeholder="0417... or +61417..."
                />
              </div>
            ) : null}
          </div>

          <div style={styles.stepsGrid}>
            <StepCard
              title="Step 1"
              hint="Delay before step 1. Set 0 hours to send immediately."
              step={s1}
              setStep={setS1}
              onTemplate={(k) => setStepTemplate(setS1, s1, k)}
              onShowEmojis={() => setEmojiTarget(emojiTarget === "s1" ? null : "s1")}
              showEmojis={emojiTarget === "s1"}
              textareaRef={s1Ref}
              onPickEmoji={onPickEmoji}
              optionStyle={optStyle}
            />
            <StepCard
              title="Step 2"
              hint="Delay after step 1."
              step={s2}
              setStep={setS2}
              onTemplate={(k) => setStepTemplate(setS2, s2, k)}
              onShowEmojis={() => setEmojiTarget(emojiTarget === "s2" ? null : "s2")}
              showEmojis={emojiTarget === "s2"}
              textareaRef={s2Ref}
              onPickEmoji={onPickEmoji}
              optionStyle={optStyle}
            />
            <StepCard
              title="Step 3"
              hint="Delay after step 2."
              step={s3}
              setStep={setS3}
              onTemplate={(k) => setStepTemplate(setS3, s3, k)}
              onShowEmojis={() => setEmojiTarget(emojiTarget === "s3" ? null : "s3")}
              showEmojis={emojiTarget === "s3"}
              textareaRef={s3Ref}
              onPickEmoji={onPickEmoji}
              optionStyle={optStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={styles.primary} onClick={startCampaign}>Start SMS campaign</button>
          </div>
        </div>

        {/* Single */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Single SMS</div>
          <div style={styles.cardSub}>Use keypad + templates for quick one-off messages.</div>

          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14 }}>
            {/* Keypad */}
            <div>
              <div style={styles.keypadWrap}>
                <div style={styles.keypadGrid}>
                  {["1","2","3","4","5","6","7","8","9","+","0","bksp"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="gr8KeypadBtn"
                      style={styles.keypadBtn}
                      onClick={() => pressKey(k)}
                      title={k === "bksp" ? "Backspace" : ""}
                    >
                      {k === "bksp" ? "⌫" : k}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="gr8KeypadClear"
                  style={styles.keypadClear}
                  onClick={() => pressKey("clear")}
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Single send */}
            <div>
              <div style={styles.label}>Phone number</div>
              <input
                style={styles.input}
                value={singleTo}
                onChange={(e) => setSingleTo(e.target.value)}
                placeholder="0417... or +61417..."
              />

              <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
                <button style={styles.primary} onClick={sendSingle}>Send SMS</button>
                <button
                  style={styles.secondary}
                  onClick={() => setEmojiTarget(emojiTarget === "single" ? null : "single")}
                >
                  {emojiTarget === "single" ? "Hide emojis" : "Show emojis"}
                </button>
              </div>

              {emojiTarget === "single" ? (
                <EmojiStrip onPick={onPickEmoji} />
              ) : null}

              {singleStatus ? (
                <div style={{ marginTop: 10, color: "rgba(255,255,255,0.90)", fontWeight: 700 }}>
                  {singleStatus}
                </div>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <div style={styles.label}>SMS message</div>
                <textarea
                  ref={singleMsgRef}
                  style={styles.textarea}
                  value={singleText}
                  onChange={(e) => setSingleText(e.target.value)}
                  placeholder="Type message…"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function StepCard({
  title,
  hint,
  step,
  setStep,
  onTemplate,
  onShowEmojis,
  showEmojis,
  textareaRef,
  onPickEmoji,
  optionStyle,
}) {
  return (
    <div style={styles.stepCard}>
      <div style={styles.stepTitle}>{title}</div>
      <div style={styles.stepHint}>{hint}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 110px", gap: 10, marginTop: 10 }}>
        <div>
          <div style={styles.label}>Template</div>
          <select style={styles.select} value={step.template} onChange={(e) => onTemplate(e.target.value)}>
            {PRESETS.map((t) => (
              <option style={optionStyle} key={t.key} value={t.key}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={styles.label}>Delay</div>
          <input
            style={styles.input}
            value={step.delay}
            onChange={(e) => setStep({ ...step, delay: e.target.value })}
          />
        </div>

        <div>
          <div style={styles.label}>Unit</div>
          <select style={styles.select} value={step.unit} onChange={(e) => setStep({ ...step, unit: e.target.value })}>
            <option style={optionStyle} value="minutes">minutes</option>
            <option style={optionStyle} value="hours">hours</option>
            <option style={optionStyle} value="days">days</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={styles.label}>Message</div>
        <button style={styles.secondarySmall} onClick={onShowEmojis} type="button">
          Show emojis
        </button>
      </div>

      {showEmojis ? <EmojiStrip onPick={onPickEmoji} /> : null}

      <textarea
        ref={textareaRef}
        style={styles.textareaSmall}
        value={step.message}
        onChange={(e) => setStep({ ...step, message: e.target.value })}
      />
    </div>
  );
}

function EmojiStrip({ onPick }) {
  return (
    <div style={styles.emojiBox}>
      {EMOJIS.map((e) => (
        <button
          key={e}
          className="gr8EmojiBtn"
          style={styles.emojiBtn}
          onClick={() => onPick(e)}
          type="button"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

const styles = {
  bannerOuter: { width: "100%", display: "flex", justifyContent: "center", padding: "16px 12px 0" },
  bannerInner: {
    width: "1440px",
    maxWidth: "100%",
    background: "linear-gradient(135deg, #16a6a0, #0f6d79)",
    borderRadius: 14,
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  },
  bannerIcon: { width: 55, height: 55, borderRadius: 12, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 },
  bannerTitle: { fontSize: 48, fontWeight: 700, color: "#ffffffff" },
  bannerSub: { marginTop: 2, fontSize: 18, color: "rgba(255, 255, 255, 0.90)", fontWeight: 700 },

  wrap: { width: "1440px", maxWidth: "100%", margin: "0 auto", padding: "12px 12px 24px", display: "grid", gap: 12 },
  notice: { border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, padding: 10 },

  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 14 },
  cardTitle: { color: "#facc15", fontWeight: 700, fontSize: 28 },
  cardSub: { marginTop: 6, color: "hsla(204, 61%, 56%, 1.00)", fontWeight: 700, fontSize: 16 },

  rowTop: { marginTop: 12, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" },
  stepsGrid: { marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },

  stepCard: { background: "rgba(0,0,0,0.20)", border: "1px solid hsla(204, 61%, 56%, 1.00)", borderRadius: 12, padding: 12 },
  stepTitle: { color: "#facc15", fontWeight: 700, fontSize: 18 },
  stepHint: { marginTop: 4, color: "rgba(255,255,255,0.65)", fontWeight: 600, fontSize: 16 },

  label: { display: "block", marginBottom: 6, color: "hsla(204, 61%, 56%, 1.00)", fontWeight: 600, fontSize: 16 },
  input: { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "white", padding: "10px 12px", fontSize: 16, outline: "none", fontWeight: 600 },

  select: {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "white",
    padding: "10px 12px",
    fontSize: 16,
    outline: "none",
    fontWeight: 600,
  },
  option: { backgroundColor: "#0b1220", color: "#ffffff" },

  textarea: {
    width: "100%",
    minHeight: 120,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "white",
    padding: "10px 12px",
    fontSize: 16,
    outline: "none",
    fontWeight: 600,
    resize: "vertical",
    fontFamily: CLEAN_FONT,
  },
  textareaSmall: {
    width: "100%",
    minHeight: 110,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "white",
    padding: "10px 12px",
    fontSize: 16,
    outline: "none",
    fontWeight: 600,
    resize: "vertical",
    fontFamily: CLEAN_FONT,
  },

  btnPill: { background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.30)", padding: "10px 14px", borderRadius: 999, fontSize: 16, fontWeight: 600, color: "white", cursor: "pointer" },
  primary: { background: "rgba(34,197,94,0.22)", border: "1px solid rgba(34,197,94,0.40)", padding: "10px 14px", borderRadius: 12, fontSize: 16, fontWeight: 600, color: "white", cursor: "pointer" },
  secondary: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "10px 14px", borderRadius: 12, fontSize: 16, fontWeight: 600, color: "white", cursor: "pointer" },
  secondarySmall: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600, color: "white", cursor: "pointer" },

  emojiBox: {
    marginTop: 8,
    marginBottom: 8,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
  },
  emojiBtn: {
    width: 64,
    height: 64,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  keypadWrap: {
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 14,
    padding: 12,
  },
  keypadGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  keypadBtn: {
    height: 64,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(99,102,241,0.25)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  keypadClear: {
    width: "100%",
    marginTop: 10,
    height: 56,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
