// /pages/modules/email/crm/calls.js
// FULL REPLACEMENT
//
// ✅ CALLING WORKS — do not break it
// ✅ Bigger keypad numbers (only UI)
// ✅ Darker dropdown background (only UI)
// ✅ Recent calls shows CONTACT NAME (not just numbers)
// ✅ Removes duplicate call rows (handled by API list-calls de-dupe)
// ✅ Recordings show on the correct call row
// ✅ Passes lead_id into call params so Twilio callback can auto-add notes

import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Device } from "@twilio/voice-sdk";
import { supabase } from "../../../../utils/supabase-client";

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function normalizePhone(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/[^\d+]/g, "");
  if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
  if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);
  return v;
}

// Simple ringback tone using WebAudio (no external files)
function createRingback() {
  let ctx = null;
  let gain = null;
  let osc = null;
  let timer = null;

  const start = async () => {
    if (timer) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.connect(ctx.destination);

    osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 440; // A
    osc.connect(gain);
    osc.start();

    // ring pattern: on 1.2s, off 2.0s
    const on = () => {
      if (!gain) return;
      gain.gain.setValueAtTime(0.0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.005);
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.02);
      setTimeout(() => {
        if (!gain || !ctx) return;
        gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.02);
      }, 1200);
    };

    on();
    timer = setInterval(on, 3200);
  };

  const stop = async () => {
    if (timer) clearInterval(timer);
    timer = null;
    try {
      if (osc) osc.stop();
    } catch {}
    osc = null;
    try {
      if (ctx) await ctx.close();
    } catch {}
    ctx = null;
    gain = null;
  };

  return { start, stop };
}

export default function CallsPage() {
  const router = useRouter();

  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [phone, setPhone] = useState("");
  const [sms, setSms] = useState("Hi, I just tried to reach you — call me back when you can. 🙂");

  const [bannerError, setBannerError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | ready | calling | in-call | ended | error
  const [callSid, setCallSid] = useState("");

  const [recentCalls, setRecentCalls] = useState([]);
  const [loadingCalls, setLoadingCalls] = useState(false);

  const deviceRef = useRef(null);
  const activeConnRef = useRef(null);
  const ringRef = useRef(null);

  useEffect(() => {
    ringRef.current = createRingback();
    return () => {
      try {
        ringRef.current?.stop?.();
      } catch {}
    };
  }, []);

  async function loadContacts() {
    setBannerError("");
    setLoadingContacts(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth?.session?.access_token || "";

      const r = await fetch("/api/crm/leads?limit=2000", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed to load contacts");

      setContacts(Array.isArray(j.leads) ? j.leads : []);
    } catch (e) {
      setBannerError(e?.message || "Failed to load contacts");
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const c = contacts.find((x) => String(x.id) === String(selectedId));
    const p = normalizePhone(c?.phone || c?.mobile || "");
    if (p) setPhone(p);
  }, [selectedId, contacts]);

  // Map phone -> lead name (for Recent Calls table name column)
  const phoneToName = useMemo(() => {
    const m = new Map();
    for (const c of contacts || []) {
      const nm = String(c?.name || c?.first_name || c?.full_name || "Unnamed").trim() || "Unnamed";
      const p1 = normalizePhone(c?.phone || "");
      const p2 = normalizePhone(c?.mobile || "");
      if (p1) m.set(p1, nm);
      if (p2) m.set(p2, nm);
    }
    return m;
  }, [contacts]);

  function resolveCallName(call) {
    const to = normalizePhone(call?.to || "");
    const from = normalizePhone(call?.from || "");

    // For outbound dial, To is the person
    if (to && phoneToName.has(to)) return phoneToName.get(to);

    // For inbound, From is the person
    if (from && phoneToName.has(from)) return phoneToName.get(from);

    // fallback
    return "";
  }

  async function ensureDevice() {
    if (deviceRef.current) return deviceRef.current;

    setBannerError("");

    const { data: auth } = await supabase.auth.getSession();
    const token = auth?.session?.access_token || "";

    const identity = "browser-user";

    const r = await fetch(`/api/telephony/voice-token?identity=${encodeURIComponent(identity)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const j = await r.json();

    if (!j?.ok || !j?.token) {
      throw new Error(j?.error || "Failed to get Twilio voice token");
    }

    const device = new Device(j.token, {
      closeProtection: true,
      logLevel: 1,
    });

    device.on("registered", () => setStatus("ready"));
    device.on("error", (err) => {
      console.error("[Twilio Device error]", err);
      setBannerError(err?.message || "Twilio device error");
      setStatus("error");
    });
    device.on("unregistered", () => setStatus("idle"));

    await device.register();

    deviceRef.current = device;
    return device;
  }

  async function loadRecentCalls() {
    setLoadingCalls(true);
    try {
      const r = await fetch("/api/twilio/list-calls?limit=50&include_recordings=1");
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed to load recent calls");
      setRecentCalls(Array.isArray(j.calls) ? j.calls : []);
    } catch (e) {
      console.error("[loadRecentCalls]", e);
    } finally {
      setLoadingCalls(false);
    }
  }

  useEffect(() => {
    loadRecentCalls();
  }, []);

  async function callNow() {
    setBannerError("");
    setCallSid("");

    const to = normalizePhone(phone);
    if (!to) return setBannerError("Phone number is required.");
    if (!to.startsWith("+")) return setBannerError("Use +61 format (E.164).");

    try {
      setStatus("calling");

      // start ringback sound immediately
      try {
        await ringRef.current?.start?.();
      } catch {}

      const device = await ensureDevice();

      // IMPORTANT:
      // Pass lead_id into the call params so TwiML callback can store notes correctly
      const conn = await device.connect({
        params: {
          To: to,
          record: "1",
          lead_id: selectedId || "",
        },
      });

      activeConnRef.current = conn;

      conn.on("accept", async () => {
        setStatus("in-call");
        try {
          await ringRef.current?.stop?.(); // stop ringback once answered
        } catch {}
        try {
          const sid = conn?.parameters?.CallSid || "";
          if (sid) setCallSid(String(sid));
        } catch {}
      });

      conn.on("disconnect", async () => {
        setStatus("ended");
        activeConnRef.current = null;
        setCallSid("");
        try {
          await ringRef.current?.stop?.();
        } catch {}

        // refresh calls list a moment later (recording can appear after hangup)
        setTimeout(loadRecentCalls, 1500);
        setTimeout(loadRecentCalls, 5000);
      });

      conn.on("cancel", async () => {
        setStatus("ended");
        activeConnRef.current = null;
        setCallSid("");
        try {
          await ringRef.current?.stop?.();
        } catch {}
        setTimeout(loadRecentCalls, 1500);
      });
    } catch (e) {
      console.error("[callNow] error:", e);
      try {
        await ringRef.current?.stop?.();
      } catch {}
      setBannerError(e?.message || "Call failed");
      setStatus("error");
    }
  }

  async function hangUp() {
    try {
      setBannerError("");
      const conn = activeConnRef.current;
      if (conn) {
        conn.disconnect();
        activeConnRef.current = null;
      }
      const device = deviceRef.current;
      if (device) device.disconnectAll();
      setStatus("ended");
      setCallSid("");
      try {
        await ringRef.current?.stop?.();
      } catch {}
      setTimeout(loadRecentCalls, 1200);
    } catch (e) {
      setBannerError(e?.message || "Failed to hang up");
    }
  }

  function pressKey(k) {
    if (k === "clear") return setPhone("");
    if (k === "back") return setPhone((p) => p.slice(0, -1));
    setPhone((p) => `${p}${k}`);
  }

  const contactOptions = useMemo(() => {
    return contacts.map((c) => ({
      id: c.id,
      label: `${c.name || c.first_name || "Unnamed"}${c.phone || c.mobile ? ` — ${c.phone || c.mobile}` : ""}`,
    }));
  }, [contacts]);

  return (
    <>
      <Head>
        <title>Calls & Voicemails | GR8</title>
      </Head>

      <div style={{ padding: 18 }}>
        {/* Banner */}
        <div
          style={{
            maxWidth: 1320,
            margin: "0 auto",
            background: "#e6469a",
            borderRadius: 14,
            padding: "18px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 10,
                background: "rgba(255,255,255,0.2)",
                display: "grid",
                placeItems: "center",
                fontSize: 48,
              }}
            >
              📞
            </div>
            <div>
              <div style={{ fontSize: 48, fontWeight: 450, color: "#fff", lineHeight: 1.1 }}>
                Calls & Voicemails
              </div>
              <div style={{ fontSize: 18, color: "rgba(255,255,255,0.9)" }}>
                Review inbound calls, listen to recordings and tidy up your call log.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={loadRecentCalls}
              style={{
                background: "#45d000",
                border: "none",
                color: "#062b00",
                fontWeight: 600,
                borderRadius: 999,
                padding: "10px 14px",
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
            <button
              onClick={() => router.push("/modules/email/crm")}
              style={{
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255, 255, 255, 0.25)",
                color: "#fff",
                fontWeight: 600,
                borderRadius: 999,
                padding: "10px 14px",
                cursor: "pointer",
              }}
            >
              ← Back to CRM
            </button>
          </div>
        </div>

        {/* Error bar */}
        {bannerError ? (
          <div
            style={{
              maxWidth: 1320,
              margin: "10px auto 0",
              background: "#7b1616",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              padding: "10px 12px",
              borderRadius: 10,
              fontWeight: 600,
            }}
          >
            {bannerError}
          </div>
        ) : null}

        {/* Main card */}
        <div
          style={{
            maxWidth: 1320,
            margin: "14px auto 0",
            background: "rgba(10,16,28,0.65)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 18,
            boxShadow: "0 14px 40px rgba(0,0,0,0.30)",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 500, color: "#fff" }}>Phone & SMS console</div>
          <div style={{ fontSize: 16, opacity: 0.8, color: "#cfd7ff", marginTop: 4 }}>
            Use the keypad to enter a number, then Call or SMS. (Use +61… format){" "}
            <span style={{ marginLeft: 10 }}>
              Device:{" "}
              <b style={{ color: status === "ready" ? "#45d000" : "#ffd54a" }}>
                {status === "ready" ? "Ready ✅" : status}
              </b>
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "320px 1fr",
              gap: 18,
              marginTop: 14,
            }}
          >
            {/* Keypad */}
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"].map((k) => (
                  <button
                    key={k}
                    onClick={() => pressKey(k === "⌫" ? "back" : k)}
                    style={{
                      height: 78, // ✅ bigger button (requested)
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "#3d57df",
                      color: "#fff",
                      fontSize: 64, // ✅ bigger number (requested)
                      fontWeight: 600,
                      cursor: "pointer",
                      lineHeight: "1",
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>

              <button
                onClick={() => pressKey("clear")}
                style={{
                  width: "100%",
                  marginTop: 12,
                  height: 52,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>

            {/* Right panel */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#f2f4fa", fontSize: 16, fontWeight: 600 }}>Select contact</div>
                  <select
                    value={selectedId}
                    disabled={loadingContacts}
                    onChange={(e) => setSelectedId(e.target.value)}
                    style={{
                      width: "100%",
                      marginTop: 6,
                      height: 38,
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.65)", // ✅ darker background (requested)
                      color: "#fff",
                      padding: "0 10px",
                      fontWeight: 500,
                    }}
                  >
                    <option value="" style={{ background: "#0b1220", color: "#fff" }}>
                      — Choose a contact —
                    </option>
                    {contactOptions.map((o) => (
                      <option key={String(o.id)} value={String(o.id)} style={{ background: "#0b1220", color: "#fff" }}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={loadContacts}
                  style={{
                    marginTop: 20,
                    background: "#45d000",
                    border: "none",
                    color: "#062b00",
                    fontWeight: 500,
                    borderRadius: 999,
                    padding: "10px 16px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Reload
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ color: "#fdfdff", fontSize: 16, fontWeight: 500 }}>Phone number</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+614xx xxx xxx"
                  style={{
                    width: "100%",
                    marginTop: 6,
                    height: 38,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.35)",
                    color: "#b2bff7",
                    padding: "0 10px",
                    fontWeight: 500,
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                <button
                  onClick={callNow}
                  style={{
                    background: "#45d000",
                    border: "none",
                    color: "#062b00",
                    fontWeight: 500,
                    borderRadius: 999,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  Call now
                </button>

                <button
                  onClick={hangUp}
                  style={{
                    background: "#d54444",
                    border: "none",
                    color: "#fff",
                    fontWeight: 500,
                    borderRadius: 999,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  Hang up
                </button>

                {callSid ? (
                  <div style={{ color: "#cfd7ff", fontWeight: 600, fontSize: 16, opacity: 0.9 }}>
                    SID: {callSid}
                  </div>
                ) : null}

                <div style={{ color: "#687bd8", fontWeight: 600, fontSize: 16, opacity: 0.8 }}>
                  {status === "calling" ? "🔔 Ringing… (browser tone)" : ""}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ color: "#cfd7ff", fontSize: 16, fontWeight: 600 }}>SMS message</div>
                <textarea
                  value={sms}
                  onChange={(e) => setSms(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.35)",
                    color: "#fff",
                    padding: 10,
                    fontWeight: 500,
                    resize: "vertical",
                  }}
                />
                <button
                  onClick={() => alert("SMS sending not wired in this file. (Calling + recordings are.)")}
                  style={{
                    marginTop: 8,
                    background: "#2a8fff",
                    border: "none",
                    color: "#fff",
                    fontWeight: 500,
                    borderRadius: 999,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  Send SMS
                </button>
              </div>
            </div>
          </div>

          {/* Recent calls */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: "#fff" }}>Recent calls</div>
              <div style={{ color: "#cfd7ff", fontWeight: 800, fontSize: 12, opacity: 0.85 }}>
                {loadingCalls ? "Loading..." : `${recentCalls.length} shown`}
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ background: "rgba(255,255,255,0.06)" }}>
                  <tr>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>When</th>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>Name</th>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>Direction</th>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>From</th>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>To</th>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>Duration</th>
                    <th style={{ padding: 10, textAlign: "left", color: "#cfd7ff" }}>Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.map((c, idx) => {
                    const nm = resolveCallName(c);
                    return (
                      <tr key={idx} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={{ padding: 10, color: "#fff", fontWeight: 500 }}>{fmtDate(c.startTime)}</td>
                        <td style={{ padding: 10, color: "#fff", fontWeight: 600 }}>{nm || "—"}</td>
                        <td style={{ padding: 10, color: "#fff", fontWeight: 500 }}>{c.direction || "-"}</td>
                        <td style={{ padding: 10, color: "#fff", fontWeight: 500 }}>{c.from || "-"}</td>
                        <td style={{ padding: 10, color: "#fff", fontWeight: 500 }}>{c.to || "-"}</td>
                        <td style={{ padding: 10, color: "#fff", fontWeight: 500 }}>
                          {Number.isFinite(Number(c.duration)) ? `${Number(c.duration)}s` : "-"}
                        </td>
                        <td style={{ padding: 10 }}>
                          {c.recordingUrl ? (
                            <audio controls preload="none" src={c.recordingUrl} style={{ height: 28, width: 240 }} />
                          ) : (
                            <span style={{ color: "#cfd7ff", opacity: 0.7, fontWeight: 600 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!recentCalls.length ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 14, color: "#cfd7ff", fontWeight: 600, opacity: 0.85 }}>
                        No calls yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 8, color: "#e2e5f7", opacity: 0.75, fontWeight: 500, fontSize: 16 }}>
              Note: recordings can appear a few seconds after hangup (Twilio processes them). This page auto-refreshes twice after hangup.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
