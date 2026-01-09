// /pages/modules/email/crm/calls.js
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../utils/supabase-client";

const LS_UNREAD_KEY = "gr8:calls:unread:v2";
const LS_HIDDEN_KEY = "gr8:calls:hidden:v2";

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Make numbers Twilio-safe (E.164-ish) without being too clever */
function normalizePhone(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/[^\d+]/g, ""); // strip spaces/dashes/() etc.

  // If user typed 614... -> +614...
  if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;

  // AU local 04xx... -> +614xx...
  if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);

  return v;
}

function lastDigits(s) {
  const d = String(s || "").replace(/[^\d]/g, "");
  return d.slice(-9);
}

export default function CallsAndVoicemails() {
  const router = useRouter();

  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);

  const [bannerText, setBannerText] = useState("");
  const [bannerType, setBannerType] = useState("info"); // info|error|success

  const [unreadMap, setUnreadMap] = useState({});
  const [hiddenMap, setHiddenMap] = useState({});
  const [selectedMap, setSelectedMap] = useState({});
  const [showHidden, setShowHidden] = useState(false);

  // Phone/SMS/Call console
  const [phoneNumber, setPhoneNumber] = useState("");
  const [smsMessage, setSmsMessage] = useState("");
  const [sendingSMS, setSendingSMS] = useState(false);
  const [callingNow, setCallingNow] = useState(false);

  // Contacts dropdown
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");

  // modal
  const [selectedCall, setSelectedCall] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // sort
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");

  // recording watcher
  const [recordWatch, setRecordWatch] = useState(null);

  function setBanner(msg, type = "info") {
    setBannerText(msg || "");
    setBannerType(type);
  }
  function clearBanner() {
    setBannerText("");
    setBannerType("info");
  }

  function loadUnread() {
    if (typeof window === "undefined") return {};
    return safeParse(window.localStorage.getItem(LS_UNREAD_KEY) || "{}", {});
  }
  function saveUnread(next) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_UNREAD_KEY, JSON.stringify(next || {}));
  }

  function loadHidden() {
    if (typeof window === "undefined") return {};
    return safeParse(window.localStorage.getItem(LS_HIDDEN_KEY) || "{}", {});
  }
  function saveHidden(next) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_HIDDEN_KEY, JSON.stringify(next || {}));
  }

  function normalizeCalls(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .filter((c) => c && c.sid)
      .map((c) => ({
        sid: c.sid,
        startTime: c.startTime || c.start_time || c.dateCreated || c.date_created || null,
        direction: c.direction || "-",
        from: c.from || "-",
        to: c.to || "-",
        duration:
          typeof c.duration === "number"
            ? c.duration
            : typeof c.duration === "string"
            ? Number(c.duration) || 0
            : 0,
        recordingSid: c.recordingSid || c.recording_sid || null,
        recordingUrl: c.recordingUrl || c.recording_url || null,
        status: c.status || c.callStatus || c.call_status || null,
      }));
  }

  function getRecordingSrc(call) {
    if (!call) return null;
    if (call.recordingSid) return `/api/twilio/recording?sid=${encodeURIComponent(call.recordingSid)}`;
    if (call.recordingUrl) return `/api/twilio/recording?url=${encodeURIComponent(call.recordingUrl)}`;
    return null;
  }

  function isVoicemailCall(call) {
    const dir = String(call?.direction || "").toLowerCase();
    return dir === "inbound" && !!(call?.recordingSid || call?.recordingUrl);
  }

  async function getBearer() {
    const sess = await supabase.auth.getSession();
    const token = sess?.data?.session?.access_token;
    return token ? `Bearer ${token}` : "";
  }

  async function loadContacts() {
    setContactsLoading(true);
    try {
      const auth = await getBearer();
      const res = await fetch("/api/crm/leads", {
        headers: auth ? { Authorization: auth } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setContacts([]);
        setBanner(data.error || "Could not load contacts for dropdown.", "error");
        return;
      }
      const arr = Array.isArray(data.leads) ? data.leads : [];
      setContacts(arr);
    } catch (e) {
      setContacts([]);
      setBanner(e?.message || "Could not load contacts for dropdown.", "error");
    } finally {
      setContactsLoading(false);
    }
  }

  async function loadCalls() {
    setLoading(true);
    clearBanner();

    try {
      const auth = await getBearer();
      const res = await fetch("/api/twilio/list-calls", {
        headers: auth ? { Authorization: auth } : {},
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        setCalls([]);
        setBanner(data.error || "Failed to load calls.", "error");
        return;
      }

      const items = normalizeCalls(data.calls);

      const storedUnread = loadUnread();
      const nextUnread = { ...storedUnread };
      for (const c of items) {
        if (typeof nextUnread[c.sid] === "undefined") nextUnread[c.sid] = isVoicemailCall(c);
      }
      setUnreadMap(nextUnread);
      saveUnread(nextUnread);

      const storedHidden = loadHidden();
      setHiddenMap(storedHidden);

      setSelectedMap((prev) => {
        const next = {};
        for (const c of items) if (prev?.[c.sid]) next[c.sid] = true;
        return next;
      });

      setCalls(items);
    } catch (err) {
      console.error(err);
      setCalls([]);
      setBanner(err?.message || "Unexpected error loading calls.", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUnreadMap(loadUnread());
    setHiddenMap(loadHidden());

    // default SMS (with emoji)
    setSmsMessage("Hi, I just tried to reach you — call me back when you can. 🙂");

    loadContacts();
    loadCalls();

    return () => {
      if (recordWatch?.timer) clearInterval(recordWatch.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setUnread(sid, unread) {
    const next = { ...(unreadMap || {}) };
    next[sid] = !!unread;
    setUnreadMap(next);
    saveUnread(next);
  }

  function hideCall(sid) {
    const next = { ...(hiddenMap || {}) };
    next[sid] = true;
    setHiddenMap(next);
    saveHidden(next);

    setSelectedMap((prev) => {
      const n = { ...(prev || {}) };
      delete n[sid];
      return n;
    });

    if (selectedCall?.sid === sid) {
      setIsModalOpen(false);
      setSelectedCall(null);
    }
  }

  function restoreHidden() {
    setHiddenMap({});
    saveHidden({});
  }

  function toggleSelected(sid) {
    setSelectedMap((prev) => {
      const next = { ...(prev || {}) };
      if (next[sid]) delete next[sid];
      else next[sid] = true;
      return next;
    });
  }

  function clearSelection() {
    setSelectedMap({});
  }

  const visibleCalls = useMemo(() => {
    const base = Array.isArray(calls) ? calls : [];
    const filtered = base.filter((c) => (showHidden ? true : !hiddenMap?.[c.sid]));

    const dateMs = (c) => {
      const t = c?.startTime ? new Date(c.startTime).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };

    const sorted = [...filtered].sort((a, b) => {
      let av, bv;

      if (sortBy === "duration") {
        av = Number(a.duration) || 0;
        bv = Number(b.duration) || 0;
      } else if (sortBy === "direction") {
        av = String(a.direction || "").toLowerCase();
        bv = String(b.direction || "").toLowerCase();
      } else {
        av = dateMs(a);
        bv = dateMs(b);
      }

      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv));
        return sortOrder === "asc" ? cmp : -cmp;
      }

      const cmp = (av || 0) - (bv || 0);
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [calls, hiddenMap, showHidden, sortBy, sortOrder]);

  const shownCount = visibleCalls.length;

  const hiddenCount = useMemo(() => {
    let n = 0;
    for (const c of calls || []) if (hiddenMap?.[c.sid]) n++;
    return n;
  }, [calls, hiddenMap]);

  const selectionCount = useMemo(() => Object.keys(selectedMap || {}).length, [selectedMap]);

  const allVisibleSelected = useMemo(() => {
    if (visibleCalls.length === 0) return false;
    for (const c of visibleCalls) if (!selectedMap?.[c.sid]) return false;
    return true;
  }, [visibleCalls, selectedMap]);

  function toggleSelectAll() {
    if (allVisibleSelected) return clearSelection();
    setSelectedMap((prev) => {
      const next = { ...(prev || {}) };
      for (const c of visibleCalls) next[c.sid] = true;
      return next;
    });
  }

  function batchHideSelected() {
    const sids = Object.keys(selectedMap || {});
    if (sids.length === 0) return;
    const next = { ...(hiddenMap || {}) };
    for (const sid of sids) next[sid] = true;
    setHiddenMap(next);
    saveHidden(next);
    setSelectedMap({});
  }

  const unreadVoicemailCount = useMemo(() => {
    let n = 0;
    for (const c of calls || []) {
      if (!isVoicemailCall(c)) continue;
      if (hiddenMap?.[c.sid]) continue;
      if (unreadMap?.[c.sid]) n++;
    }
    return n;
  }, [calls, hiddenMap, unreadMap]);

  function openModal(call) {
    setSelectedCall(call);

    const dir = String(call?.direction || "").toLowerCase();
    const other = dir === "inbound" ? call?.from : call?.to;
    if (other && !phoneNumber) setPhoneNumber(other);

    setIsModalOpen(true);

    if (isVoicemailCall(call) && unreadMap?.[call.sid]) setUnread(call.sid, false);
  }

  function closeModal() {
    setIsModalOpen(false);
    setSelectedCall(null);
  }

  // keypad
  function keypadAppend(ch) {
    setPhoneNumber((prev) => `${prev || ""}${ch}`);
  }
  function keypadBackspace() {
    setPhoneNumber((prev) => String(prev || "").slice(0, -1));
  }
  function keypadClear() {
    setPhoneNumber("");
  }

  function onPickContact(id) {
    setSelectedContactId(id);
    const c = contacts.find((x) => String(x.id) === String(id));
    if (!c) return;
    if (c.phone) setPhoneNumber(String(c.phone));
  }

  async function sendSMS() {
    const rawNum = phoneNumber.trim();
    const num = normalizePhone(rawNum);
    const msg = smsMessage; // keep emojis

    if (!rawNum) return setBanner("Enter a phone number first.", "error");
    if (!num.startsWith("+")) return setBanner("Phone must include country code (e.g. +614xx...).", "error");
    if (!String(msg || "").trim()) return setBanner("Type a message first.", "error");

    setSendingSMS(true);
    clearBanner();

    try {
      const auth = await getBearer();
      const res = await fetch("/api/telephony/send-sms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({ to: num, message: msg }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        setBanner(data.error || "SMS failed.", "error");
        return;
      }

      setBanner("SMS submitted.", "success");
      setSmsMessage("");
      setPhoneNumber(num); // keep normalized
    } catch (err) {
      setBanner(err?.message || "SMS failed.", "error");
    } finally {
      setSendingSMS(false);
    }
  }

  async function attachRecordingToLead({ leadId, call }) {
    if (!leadId || !call) return;
    const rec = getRecordingSrc(call);
    if (!rec) return;

    try {
      const auth = await getBearer();
      const payload = {
        lead_id: leadId,
        note: `📞 Call recording (${(Number(call.duration) || 0)}s)\nFrom: ${call.from}\nTo: ${call.to}\nWhen: ${fmtDate(
          call.startTime
        )}\nRecording: ${rec}`,
        meta: {
          type: "call_recording",
          call_sid: call.sid,
          recording_sid: call.recordingSid || null,
          recording_url: call.recordingUrl || null,
          duration: Number(call.duration) || 0,
          start_time: call.startTime || null,
          from: call.from || null,
          to: call.to || null,
        },
      };

      const res = await fetch("/api/crm/leads/add-note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        // do not spam banner
        return;
      }
    } catch {
      // ignore
    }
  }

  function stopRecordingWatch() {
    if (recordWatch?.timer) clearInterval(recordWatch.timer);
    setRecordWatch(null);
  }

  async function startRecordingWatch({ leadId, toNumber }) {
    stopRecordingWatch();
    const startedAt = Date.now();
    const toDigits = lastDigits(toNumber);

    const timer = setInterval(async () => {
      try {
        // stop after 3 minutes
        if (Date.now() - startedAt > 3 * 60 * 1000) {
          clearInterval(timer);
          setRecordWatch(null);
          return;
        }

        const auth = await getBearer();
        const res = await fetch("/api/twilio/list-calls", {
          headers: auth ? { Authorization: auth } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) return;

        const items = normalizeCalls(data.calls);
        // Find newest call that matches this "to" and has a recording
        const match = items.find((c) => {
          const recOk = !!(c.recordingSid || c.recordingUrl);
          if (!recOk) return false;
          const toOk = lastDigits(c.to) === toDigits || lastDigits(c.from) === toDigits;
          return toOk && (Number(c.duration) || 0) > 0;
        });

        if (match) {
          await attachRecordingToLead({ leadId, call: match });
          clearInterval(timer);
          setRecordWatch(null);
          // refresh calls list to show recording control
          loadCalls();
        }
      } catch {
        // ignore and continue polling
      }
    }, 4000);

    setRecordWatch({ timer });
  }

  async function callNow() {
    const rawNum = phoneNumber.trim();
    const num = normalizePhone(rawNum);

    if (!rawNum) return setBanner("Enter a phone number first.", "error");
    if (!num.startsWith("+")) return setBanner("Phone must include country code (e.g. +614xx...).", "error");

    setCallingNow(true);
    clearBanner();

    try {
      const auth = await getBearer();
      const res = await fetch("/api/telephony/make-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({ to: num, lead_id: selectedContactId || null, record: true }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        setBanner(data.error || "Call failed.", "error");
        return;
      }

      setBanner("Calling you now — answer to connect.", "success");
      setPhoneNumber(num);

      // watch for recording and attach to lead notes
      if (selectedContactId) startRecordingWatch({ leadId: selectedContactId, toNumber: num });

      setTimeout(() => loadCalls(), 1200);
    } catch (err) {
      setBanner(err?.message || "Call failed.", "error");
    } finally {
      setCallingNow(false);
    }
  }

  const bannerClass =
    !bannerText
      ? "notice notice-empty"
      : bannerType === "error"
      ? "notice notice-error"
      : bannerType === "success"
      ? "notice notice-success"
      : "notice";

  return (
    <>
      <Head>
        <title>Calls & Voicemails | GR8</title>
      </Head>

      <main className="page">
        <section className="banner">
          <div className="bannerLeft">
            <div className="bannerIcon">📞</div>
            <div className="bannerText">
              <div className="bannerTitle">Calls & Voicemails</div>
              <div className="bannerSub">Review inbound calls, listen to recordings and tidy up your call log.</div>
            </div>
          </div>

          <div className="bannerRight">
            <button
              className={`pill ${unreadVoicemailCount > 0 ? "pillFlash" : "pillGrey"}`}
              onClick={() => {
                const first = (calls || []).find(
                  (c) => isVoicemailCall(c) && unreadMap?.[c.sid] && !hiddenMap?.[c.sid]
                );
                if (first) openModal(first);
                else loadCalls();
              }}
              title={unreadVoicemailCount > 0 ? "Unread voicemails" : "No unread voicemails"}
            >
              {unreadVoicemailCount > 0 ? `Voicemails (${unreadVoicemailCount})` : "Voicemails"}
            </button>

            <button className="pill pillGreen" onClick={loadCalls}>
              Refresh
            </button>

            <button className="pill pillDark" onClick={() => router.push("/modules/email/crm")}>
              ← Back to CRM
            </button>
          </div>
        </section>

        <section className={bannerClass}>{bannerText || " "}</section>

        <section className="card">
          <div className="cardHead">
            <h2>Phone & SMS console</h2>
            <p>Use the keypad to enter a number, then Call or SMS. (Use +61… format)</p>
          </div>

          <div className="consoleGrid">
            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0"].map((k) => (
                <button key={k} className="keyBtn" onClick={() => keypadAppend(k)}>
                  {k}
                </button>
              ))}
              <button className="keyBtn keyBack" onClick={keypadBackspace} title="Backspace">
                ⌫
              </button>
              <button className="keyBtn keyClear" onClick={keypadClear}>
                Clear
              </button>
            </div>

            <div className="fields">
              <div className="rowLine">
                <div style={{ flex: 1 }}>
                  <label className="lab">Select contact</label>
                  <select
                    className="inp"
                    value={selectedContactId}
                    onChange={(e) => onPickContact(e.target.value)}
                    disabled={contactsLoading}
                  >
                    <option value="">{contactsLoading ? "Loading..." : "— Choose a contact —"}</option>
                    {(contacts || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.email || c.phone || `Lead #${c.id}`}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="pill pillGreen" style={{ padding: "8px 14px" }} onClick={loadContacts}>
                  Reload
                </button>
              </div>

              <label className="lab">Phone number</label>
              <input
                className="inp inpPhone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+614xx xxx xxx"
              />

              <div className="btnRow">
                <button className="btn btnCall" onClick={callNow} disabled={callingNow}>
                  {callingNow ? "Calling..." : "Call now"}
                </button>
              </div>

              <label className="lab" style={{ marginTop: 8 }}>
                SMS message
              </label>
              <textarea
                className="inp inpEmoji"
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                rows={4}
                placeholder="Type your message..."
              />

              <div className="btnRow">
                <button className="btn btnSMS" onClick={sendSMS} disabled={sendingSMS}>
                  {sendingSMS ? "Sending..." : "Send SMS"}
                </button>
                {recordWatch ? <span style={{ opacity: 0.85, fontWeight: 700 }}>Watching for recording…</span> : null}
              </div>
            </div>
          </div>
        </section>

        {/* CALLS LIST */}
        <section className="card">
          <div className="listHead">
            <div>
              <h2>Recent calls</h2>
              <div className="subline">
                {shownCount} shown • hidden: {hiddenCount}
              </div>
            </div>

            <div className="listTools">
              <label className="chkLine">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
                <span>Show hidden</span>
              </label>

              <div className="sortLine">
                <span>Sort</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="date">Date</option>
                  <option value="duration">Duration</option>
                  <option value="direction">Direction</option>
                </select>

                <span>Order</span>
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bulk">
            <button className="bulkBtn" onClick={toggleSelectAll} disabled={visibleCalls.length === 0}>
              {allVisibleSelected ? "Clear all" : "Select all"}
            </button>

            <button className="bulkBtn bulkGhost" onClick={clearSelection} disabled={selectionCount === 0}>
              Clear selection
            </button>

            <div className="spacer" />

            <button className="bulkBtn bulkDanger" onClick={batchHideSelected} disabled={selectionCount === 0}>
              Delete (hide) selected ({selectionCount})
            </button>

            <button className="bulkBtn" onClick={restoreHidden} disabled={hiddenCount === 0}>
              Restore hidden
            </button>
          </div>

          {loading ? (
            <div className="empty">Loading...</div>
          ) : visibleCalls.length === 0 ? (
            <div className="empty">No calls found (or all hidden).</div>
          ) : (
            <div className="tableWrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="thChk">Select</th>
                    <th>Status</th>
                    <th>When</th>
                    <th>Direction</th>
                    <th>From</th>
                    <th>To</th>
                    <th className="tdC">Duration</th>
                    <th>Recording</th>
                    <th className="thActions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCalls.map((c) => {
                    const unread = !!unreadMap?.[c.sid];
                    const isVM = isVoicemailCall(c);
                    const rec = getRecordingSrc(c);

                    return (
                      <tr key={c.sid} className={`row ${unread && isVM ? "rowUnread" : ""}`} onClick={() => openModal(c)}>
                        <td className="tdChk" onClick={(e) => e.stopPropagation()}>
                          <input
                            className="bigChk"
                            type="checkbox"
                            checked={!!selectedMap?.[c.sid]}
                            onChange={() => toggleSelected(c.sid)}
                          />
                        </td>

                        <td>
                          {isVM ? (
                            <span className={`badge ${unread ? "badgeUnread" : "badgeRead"}`}>
                              {unread ? "Unread" : "Read"}
                            </span>
                          ) : (
                            <span className="badge badgeNeutral">Call</span>
                          )}
                        </td>

                        <td>{fmtDate(c.startTime)}</td>
                        <td>{c.direction}</td>
                        <td>{c.from}</td>
                        <td>{c.to}</td>
                        <td className="tdC">{(Number(c.duration) || 0) + "s"}</td>

                        <td onClick={(e) => e.stopPropagation()}>{rec ? <audio controls className="audio" src={rec} /> : "-"}</td>

                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {isVM ? (
                            <button className={`aBtn ${unread ? "aGreen" : "aAmber"}`} onClick={() => setUnread(c.sid, !unread)}>
                              {unread ? "Mark read" : "Mark unread"}
                            </button>
                          ) : (
                            <button className="aBtn aNeutral" disabled>
                              —
                            </button>
                          )}

                          <button className="aBtn aRed" onClick={() => hideCall(c.sid)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* MODAL */}
        {isModalOpen && selectedCall && (
          <div className="overlay" onClick={closeModal}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modalTop">
                <h3>Call / Voicemail</h3>
                <button className="pill pillDark" onClick={closeModal}>
                  Close
                </button>
              </div>

              <div className="modalGrid">
                <div className="modalCol">
                  <p>
                    <b>When:</b> {fmtDate(selectedCall.startTime)}
                  </p>
                  <p>
                    <b>Direction:</b> {selectedCall.direction}
                  </p>
                  <p>
                    <b>From:</b> {selectedCall.from}
                  </p>
                  <p>
                    <b>To:</b> {selectedCall.to}
                  </p>
                  <p>
                    <b>Duration:</b> {(Number(selectedCall.duration) || 0) + "s"}
                  </p>

                  {getRecordingSrc(selectedCall) ? (
                    <>
                      <div style={{ height: 8 }} />
                      <audio controls style={{ width: "100%" }} src={getRecordingSrc(selectedCall)} />
                    </>
                  ) : (
                    <p style={{ opacity: 0.7 }}>No recording attached.</p>
                  )}
                </div>

                <div className="modalCol">
                  <label className="lab">Phone number</label>
                  <input className="inp inpPhone" type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />

                  <div className="btnRow" style={{ marginTop: 10 }}>
                    <button className="btn btnCall" onClick={callNow} disabled={callingNow}>
                      {callingNow ? "Calling..." : "Call now"}
                    </button>
                  </div>

                  <label className="lab" style={{ marginTop: 10 }}>
                    SMS message
                  </label>
                  <textarea className="inp inpEmoji" rows={4} value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)} />

                  <div className="modalBtns">
                    <button className="btn btnSMS" onClick={sendSMS} disabled={sendingSMS}>
                      {sendingSMS ? "Sending..." : "Send SMS"}
                    </button>

                    <button className="btn btnDel" onClick={() => hideCall(selectedCall.sid)}>
                      Delete (hide)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <style jsx>{`
          .page {
            min-height: 100vh;
            padding: 22px 28px 60px;
            background: #020617;
            color: #e5e7eb;
          }

          .banner {
            max-width: 1320px;
            margin: 0 auto 14px;
            background: #ec4899;
            border-radius: 16px;
            padding: 18px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }
          .bannerLeft {
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .bannerIcon {
            width: 65px;
            height: 65px;
            border-radius: 14px;
            background: rgba(248, 244, 244, 0.99);
            display: grid;
            place-items: center;
            font-size: 48px;
          }
          .bannerTitle {
            font-size: 48px;
            font-weight: 600;
            line-height: 1.05;
            color: #fff;
          }
          .bannerSub {
            font-size: 18px;
            opacity: 0.95;
            margin-top: 4px;
            color: #eaf6ff;
          }
          .bannerRight {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            justify-content: flex-end;
          }
          .pill {
            border: none;
            border-radius: 999px;
            padding: 10px 16px;
            font-weight: 600;
            cursor: pointer;
            font-size: 18px;
          }
          .pillDark {
            background: rgba(2, 6, 23, 0.7);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.18);
          }
          .pillGreen {
            background: rgba(69, 197, 9, 1);
            color: #052e1f;
          }
          .pillGrey {
            background: rgba(148, 163, 184, 0.28);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.18);
          }
          .pillFlash {
            background: #f80707ff;
            color: #fff;
            animation: flash 0.9s infinite;
          }
          @keyframes flash {
            0% {
              transform: scale(1);
              filter: brightness(1);
            }
            50% {
              transform: scale(1.1);
              filter: brightness(1.2);
            }
            100% {
              transform: scale(1);
              filter: brightness(1);
            }
          }

          .notice {
            max-width: 1320px;
            margin: 0 auto 14px;
            min-height: 44px;
            display: flex;
            align-items: center;
            padding: 10px 14px;
            border-radius: 12px;
            background: rgba(15, 23, 42, 0.75);
            border: 1px solid rgba(148, 163, 184, 0.24);
            font-size: 16px;
          }
          .notice-empty {
            opacity: 0;
            pointer-events: none;
          }
          .notice-error {
            background: rgba(127, 29, 29, 0.88);
            border-color: rgba(248, 113, 113, 0.6);
          }
          .notice-success {
            background: rgba(6, 95, 70, 0.88);
            border-color: rgba(52, 211, 153, 0.55);
          }

          .card {
            max-width: 1500px;
            margin: 0 auto 14px;
            padding: 16px 18px 18px;
            border-radius: 16px;
            background: rgba(15, 23, 42, 0.96);
            border: 1px solid rgba(31, 41, 55, 0.95);
          }
          .cardHead h2,
          .listHead h2 {
            margin: 0;
            margin-left: 32px;
            font-size: 32px;
            font-weight: 500;
          }
          .cardHead p {
            margin: 6px 0 0;
            color: #9ca3af;
            font-size: 16px;
          }

          .consoleGrid {
            display: grid;
            grid-template-columns: 420px 1fr;
            gap: 46px;
            margin-top: 32px;
            margin-left: 32px;
            align-items: start;
          }
          .keypad {
            padding: 14px;
            border-radius: 16px;
            background: rgba(148, 163, 184, 0.1);
            border: 1px solid rgba(148, 163, 184, 0.2);
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
          }

          .keyBtn {
            height: 66px;
            border-radius: 18px;
            border: 1px solid rgba(97, 120, 153, 0.25);
            background: rgba(59, 90, 228, 0.99);
            color: #fff;
            font-weight: 600;
            font-size: 44px !important;
            line-height: 1 !important;
            cursor: pointer;
            letter-spacing: 0.5px;
          }
          .keyBack {
            font-size: 36px !important;
          }
          .keyClear {
            grid-column: span 3;
            height: 60px;
            font-size: 24px !important;
            font-weight: 600;
            background: rgba(239, 68, 68, 0.16);
            border-color: rgba(239, 68, 68, 0.35);
          }

          .fields {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .rowLine {
            display: flex;
            gap: 12px;
            align-items: flex-end;
          }
          .lab {
            font-weight: 500;
            color: #cbd5e1;
            font-size: 26px;
          }
          .inp {
            background: #020617;
            border: 1px solid #1f2937;
            border-radius: 12px;
            padding: 10px 12px;
            font-size: 16px;
            color: #e5e7eb;
          }
          .inpEmoji {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji",
              "Segoe UI Symbol";
          }
          .inpPhone {
            font-variant-numeric: tabular-nums;
            letter-spacing: 0.5px;
            font-size: 18px;
          }
          .btnRow {
            margin-top: 8px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: center;
          }
          .btn {
            border: none;
            border-radius: 999px;
            padding: 12px 16px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
          }
          .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .btnSMS {
            background: #0ea5e9;
            color: #e0f2fe;
          }
          .btnCall {
            background: rgba(34, 197, 94, 0.95);
            color: #052e1f;
          }

          .listHead {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 14px;
            margin-bottom: 10px;
          }
          .subline {
            margin-top: 4px;
            font-size: 16px;
            color: #94a3b8;
          }
          .listTools {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }
          .chkLine {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-weight: 800;
            color: #cbd5e1;
          }
          .chkLine input {
            width: 22px;
            height: 22px;
            accent-color: #22c55e;
          }
          .sortLine {
            display: inline-flex;
            gap: 8px;
            align-items: center;
            font-weight: 800;
            color: #cbd5e1;
          }
          select {
            background: #020617;
            color: #e5e7eb;
            border: 1px solid rgba(148, 163, 184, 0.25);
            border-radius: 10px;
            padding: 6px 10px;
            font-weight: 800;
          }

          .bulk {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 0 12px;
            border-top: 1px solid rgba(148, 163, 184, 0.12);
          }
          .spacer {
            flex: 1;
          }
          .bulkBtn {
            border-radius: 999px;
            padding: 9px 14px;
            border: 1px solid rgba(148, 163, 184, 0.25);
            background: rgba(2, 6, 23, 0.25);
            color: #e5e7eb;
            font-weight: 500;
            cursor: pointer;
          }
          .bulkBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .bulkGhost {
            background: transparent;
          }
          .bulkDanger {
            background: rgba(239, 68, 68, 0.18);
            border-color: rgba(239, 68, 68, 0.35);
          }

          .empty {
            padding: 12px 4px;
            color: #9ca3af;
            font-size: 16px;
          }

          .tableWrap {
            overflow-x: auto;
          }
          .tbl {
            width: 100%;
            border-collapse: collapse;
            font-size: 16px;
          }
          th,
          td {
            padding: 10px 10px;
            border-bottom: 1px solid rgba(31, 41, 55, 0.95);
            text-align: left;
            vertical-align: middle;
            white-space: nowrap;
          }
          th {
            color: #cbd5e1;
            font-weight: 500;
          }
          .thChk,
          .tdChk {
            width: 90px;
          }
          .tdC {
            text-align: center;
          }

          .bigChk {
            width: 56px;
            height: 26px;
            accent-color: #22c55e;
            cursor: pointer;
          }

          .row {
            cursor: pointer;
          }
          .row:hover {
            background: rgba(148, 163, 184, 0.12);
          }
          .rowUnread {
            background: rgba(239, 68, 68, 0.06);
          }

          .badge {
            display: inline-flex;
            align-items: center;
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 16px;
            font-weight: 500;
            border: 1px solid rgba(148, 163, 184, 0.25);
          }
          .badgeUnread {
            background: rgba(239, 68, 68, 0.18);
            color: #fecaca;
            border-color: rgba(248, 113, 113, 0.5);
          }
          .badgeRead {
            background: rgba(16, 185, 129, 0.18);
            color: #a7f3d0;
            border-color: rgba(52, 211, 153, 0.4);
          }
          .badgeNeutral {
            background: rgba(148, 163, 184, 0.12);
            color: #e5e7eb;
          }

          .audio {
            width: 240px;
          }

          .actions {
            display: grid;
            grid-template-columns: 120px 120px;
            gap: 10px;
            justify-content: end;
          }
          .aBtn {
            border: none;
            border-radius: 999px;
            padding: 10px 12px;
            font-weight: 500;
            cursor: pointer;
            font-size: 18px;
            text-align: center;
          }
          .aBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .aGreen {
            background: #22c55e;
            color: #052e1f;
          }
          .aAmber {
            background: #f59e0b;
            color: #111827;
          }
          .aRed {
            background: #ef4444;
            color: #fff;
          }
          .aNeutral {
            background: rgba(148, 163, 184, 0.18);
            color: #e5e7eb;
          }

          .overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
          }
          .modal {
            width: 96%;
            max-width: 980px;
            background: #0e258aff;
            border-radius: 18px;
            padding: 16px 16px 14px;
            border: 1px solid rgba(148, 163, 184, 0.35);
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
          }
          .modalTop {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
          }
          .modalTop h3 {
            margin: 0;
            font-size: 32px;
            font-weight: 500;
          }
          .modalGrid {
            display: grid;
            grid-template-columns: 1.1fr 1fr;
            gap: 14px;
          }
          .modalCol p {
            margin: 6px 0;
            font-size: 16px;
          }
          .modalBtns {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 10px;
          }
          .btnDel {
            background: #ef4444;
            color: #fff;
          }

          @media (max-width: 1050px) {
            .consoleGrid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </main>
    </>
  );
}
