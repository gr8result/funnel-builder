// /components/crm/LeadDetailsModal.js
// FULL REPLACEMENT
//
// ✅ Keeps LEFT dialer (BrowserDialer) intact
// ✅ NO “audio player panel above notes” (recordings are rendered as compact timeline rows INSIDE the Notes box)
// ✅ DOES NOT write any junk text into notes (NO SID markers / NO auto-import text)
// ✅ Loads recordings from Supabase crm_calls via server API: /api/crm/lead-call-recordings (service role)
// ✅ Also tries Twilio list endpoint (optional): /api/twilio/list-call-recordings?phone=...
// ✅ Plays audio using:
//    - recordingUrl -> /api/twilio/recording-audio?url=...
//    - recordingSid (RE...) -> /api/twilio/recording?sid=...
// ✅ Dedupes + sorts newest first
// ✅ Fixes the hard-coded placeholder name (“Grant”) to generic text

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../utils/supabase-client";
import LeadInfoCard from "./LeadInfoCard";
import BrowserDialer from "../telephony/BrowserDialer";
import SendToAutomationPanel from "./SendToAutomationPanel";

export default function LeadDetailsModal({
  isOpen,
  lead,
  stages = [],
  userId,
  fontScale = 1.35,
  onClose,
  onNotesUpdated,
}) {
  const router = useRouter();

  if (!isOpen || !lead) return null;

  // -------------------- HELPERS --------------------
  const scaled = (v) => Math.round(v * fontScale);

  function s(v) {
    return String(v ?? "").trim();
  }

  function normalizePhoneE164AU(raw) {
    let v = s(raw);
    if (!v) return "";
    v = v.replace(/[^\d+]/g, "");
    if (!v) return "";
    if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
    if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);
    return v;
  }

  function formatCallTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDurationSeconds(value) {
    if (value == null) return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (n < 60) return `${n}s`;
    const m = Math.floor(n / 60);
    const rem = n % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}h ${remM}m`;
    }
    return `${m}m ${rem}s`;
  }

  // Clean ONLY legacy “Call recording ready...” junk. DOES NOT remove real user notes.
  function stripLegacyCallJunk(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);
    const out = [];

    let skipping = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const l = line.trim();

      if (/^Call recording ready/i.test(l)) {
        skipping = true;
        continue;
      }

      if (skipping) {
        if (!l) skipping = false;
        continue;
      }

      out.push(line);
    }

    return out.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd();
  }

  // Try to extract a Twilio Recording SID from a Twilio RecordingUrl
  // Typical: https://api.twilio.com/2010-04-01/Accounts/{AC}/Recordings/RE123....json
  function extractRecordingSidFromUrl(url) {
    const u = s(url);
    if (!u) return "";
    const m = u.match(/\/Recordings\/(RE[a-zA-Z0-9]+)(?:\.json)?/);
    return m?.[1] || "";
  }

  // -------------------- STYLES / COLORS --------------------
  const stageColor = stages.find((st) => st.id === lead.stage)?.color || "#3b82f6";
  const panelTint = {
    background: `linear-gradient(135deg, rgba(15,23,42,0.98), ${stageColor}33)`,
  };

  // -------------------- STATE --------------------
  const [leadNotes, setLeadNotes] = useState(stripLegacyCallJunk(lead.notes || ""));
  const [leadTasks, setLeadTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  const [newTaskType, setNewTaskType] = useState("phone_call");
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");

  // voice-to-text (microphone)
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const recordingRef = useRef(false);
  const silenceTimeoutRef = useRef(null);

  // dialer toggle
  const [showDialer, setShowDialer] = useState(true);

  // recordings (merged)
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [mergedRecordings, setMergedRecordings] = useState([]);

  // calendar
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // automation panel
  const [showAutomation, setShowAutomation] = useState(false);

  // draggable + resizable
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 });
  const DEFAULT_WIDTH = 1450;
  const DEFAULT_HEIGHT = 820;
  const [modalSize, setModalSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [isModalDragging, setIsModalDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const modalDragRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0 });
  const modalResizeRef = useRef({
    startX: 0,
    startY: 0,
    startWidth: DEFAULT_WIDTH,
    startHeight: DEFAULT_HEIGHT,
  });

  // -------------------- EFFECTS --------------------
  useEffect(() => {
    if (!isOpen || !lead || !userId) return;

    // load notes (only strip legacy junk)
    setLeadNotes(stripLegacyCallJunk(lead.notes || ""));

    setLeadTasks([]);
    setNewTaskText("");
    setNewTaskDate("");
    setNewTaskTime("");
    setIsCalendarOpen(false);
    setShowDialer(true);
    setShowAutomation(false);

    setRecError("");
    setMergedRecordings([]);

    setModalOffset({ x: 0, y: 0 });
    setModalSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

    loadTasksForLead(lead.id);

    // load recordings (db + twilio)
    loadAllRecordings();

    // recordings can appear after hangup
    setTimeout(() => loadAllRecordings(), 6000);
    setTimeout(() => loadAllRecordings(), 15000);
    setTimeout(() => loadAllRecordings(), 30000);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lead?.id, lead?.phone, userId]);

  useEffect(() => {
    function handleMouseMove(e) {
      if (isModalDragging) {
        const { startX, startY, originX, originY } = modalDragRef.current;
        setModalOffset({ x: originX + (e.clientX - startX), y: originY + (e.clientY - startY) });
      }
      if (isResizing) {
        const { startX, startY, startWidth, startHeight } = modalResizeRef.current;
        const newWidth = Math.max(700, startWidth + (e.clientX - startX));
        const newHeight = Math.max(420, startHeight + (e.clientY - startY));
        setModalSize({ width: newWidth, height: newHeight });
      }
    }

    function handleMouseUp() {
      if (isModalDragging) setIsModalDragging(false);
      if (isResizing) setIsResizing(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isModalDragging, isResizing]);

  useEffect(() => {
    function onDocClick(e) {
      if (!showAutomation) return;
      const el = e.target;
      if (!el) return;
      const box = document.getElementById("gr8-automation-popover");
      const btn = document.getElementById("gr8-automation-toggle");
      if (box && box.contains(el)) return;
      if (btn && btn.contains(el)) return;
      setShowAutomation(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showAutomation]);

  // -------------------- DB HELPERS --------------------
  async function loadTasksForLead(leadId) {
    if (!userId || !leadId) return;
    setTasksLoading(true);

    const { data, error } = await supabase
      .from("crm_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("contact_id", leadId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadTasksForLead error:", error);
      setLeadTasks([]);
    } else {
      setLeadTasks(data || []);
    }
    setTasksLoading(false);
  }

  // Load recordings from crm_calls via SERVER API (service role) to avoid RLS empty results in browser
  async function loadDbRecordings() {
    try {
      if (!lead?.id) return [];

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || "";
      if (!token) return [];

      const r = await fetch(`/api/crm/lead-call-recordings?lead_id=${encodeURIComponent(lead.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await r.json();
      if (!j?.ok) {
        console.warn("lead-call-recordings not ok:", j);
        return [];
      }

      const rows = Array.isArray(j?.recordings) ? j.recordings : [];

      return (rows || [])
        .filter((row) => row && (s(row.recording_url) || s(row.recordingUrl) || s(row.recording_url_text) || s(row.recordingSid) || s(row.recording_sid) || s(row.sid)))
        .map((row) => {
          // IMPORTANT:
          // - crm_calls often has recording_url (Twilio recording URL) and call_sid (CA...) etc.
          // - We DO NOT treat CA... as a recording sid (recording sids are RE...)
          const recordingUrl = s(
            row.recordingUrl ||
              row.recording_url ||
              row.recording_url_text ||
              row.recordingUrlText ||
              row.recording ||
              row.url ||
              ""
          );

          const extractedRecordingSid = extractRecordingSidFromUrl(recordingUrl);
          const recordingSid = s(row.recordingSid || row.recording_sid || "").startsWith("RE")
            ? s(row.recordingSid || row.recording_sid)
            : extractedRecordingSid || "";

          const createdAt =
            row.createdAt ||
            row.created_at ||
            row.dateCreated ||
            row.date_created ||
            row.created ||
            row.timestamp ||
            null;

          const duration = row.duration ?? row.recordingDuration ?? row.recording_duration ?? row.recording_duration_seconds ?? null;

          const from = s(row.from || row.from_number || row.caller || row.src || row.caller_name || "");
          const to = s(row.to || row.to_number || row.called || row.dst || "");

          // stable key for dedupe
          const key =
            recordingSid ? `re:${recordingSid}` : recordingUrl ? `url:${recordingUrl}` : `db:${row.id || Math.random().toString(16).slice(2)}`;

          return {
            key,
            source: "db",
            recordingSid,
            recordingUrl,
            createdAt,
            duration,
            from,
            to,
          };
        });
    } catch (e) {
      console.error("loadDbRecordings error:", e);
      return [];
    }
  }

  // Load recordings from Twilio API route (optional)
  async function loadTwilioRecordings() {
    const rawPhone = s(lead?.phone);
    if (!rawPhone) return [];

    const phoneE164 = normalizePhoneE164AU(rawPhone);
    const phoneToQuery = phoneE164 || rawPhone;

    try {
      const r = await fetch(`/api/twilio/list-call-recordings?phone=${encodeURIComponent(phoneToQuery)}&limit=50`);
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed to load recordings from Twilio");

      const recs = Array.isArray(j?.recordings) ? j.recordings : [];

      return recs
        .filter((x) => x && (s(x.recordingSid || x.sid) || s(x.recordingUrl || x.recording_url || x.url)))
        .map((x) => {
          const recordingUrl = s(x.recordingUrl || x.recording_url || x.url || "");
          const extracted = extractRecordingSidFromUrl(recordingUrl);
          const recordingSid = s(x.recordingSid || x.sid).startsWith("RE") ? s(x.recordingSid || x.sid) : extracted || "";

          const createdAt =
            x.dateCreated ||
            x.date_created ||
            x.createdAt ||
            x.created_at ||
            x.startTime ||
            x.start_time ||
            x.timestamp ||
            null;

          const duration = x.duration ?? x.recordingDuration ?? x.recording_duration ?? null;

          const from = s(x.from || x.from_number || x.caller || "");
          const to = s(x.to || x.to_number || x.called || "");

          const key = recordingSid ? `re:${recordingSid}` : recordingUrl ? `url:${recordingUrl}` : `tw:${Math.random().toString(16).slice(2)}`;

          return {
            key,
            source: "twilio",
            recordingSid,
            recordingUrl,
            createdAt,
            duration,
            from,
            to,
          };
        });
    } catch (e) {
      console.error("loadTwilioRecordings error:", e);
      throw e;
    }
  }

  // Merge + dedupe + sort by date DESC
  async function loadAllRecordings() {
    setRecLoading(true);
    setRecError("");
    setMergedRecordings([]);

    try {
      const [dbList, twList] = await Promise.all([loadDbRecordings(), loadTwilioRecordings().catch(() => [])]);

      const map = new Map();

      function dedupeKey(item) {
        const re = s(item?.recordingSid);
        const url = s(item?.recordingUrl);
        if (re) return `re:${re}`;
        if (url) return `url:${url}`;
        return s(item?.key) || `x:${Math.random().toString(16).slice(2)}`;
      }

      for (const item of dbList) {
        if (!item) continue;
        map.set(dedupeKey(item), item);
      }

      for (const item of twList) {
        if (!item) continue;
        const k = dedupeKey(item);
        if (!map.has(k)) map.set(k, item);
        else {
          const existing = map.get(k);
          map.set(k, {
            ...existing,
            // prefer DB but fill gaps
            recordingUrl: existing?.recordingUrl || item?.recordingUrl || "",
            createdAt: existing?.createdAt || item?.createdAt || null,
            duration: existing?.duration ?? item?.duration ?? null,
            from: existing?.from || item?.from || "",
            to: existing?.to || item?.to || "",
          });
        }
      }

      const merged = Array.from(map.values());

      merged.sort((a, b) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      setMergedRecordings(merged);
    } catch (e) {
      setRecError(e?.message || "Unable to load recordings.");
      setMergedRecordings([]);
    } finally {
      setRecLoading(false);
    }
  }

  // -------------------- NOTES SAVE --------------------
  async function handleSaveLeadNotes() {
    if (!lead) return;

    const clean = stripLegacyCallJunk(leadNotes);

    try {
      const { error } = await supabase.from("leads").update({ notes: clean, updated_at: new Date() }).eq("id", lead.id);

      if (error) {
        console.error("Save notes error:", error);
        alert("There was an error saving notes.");
        return;
      }

      if (onNotesUpdated) onNotesUpdated(lead.id, clean);

      alert("Notes saved.");
      handleCloseInternal();
    } catch (err) {
      console.error("Save notes error:", err);
      alert("There was an error saving notes.");
    }
  }

  // -------------------- VOICE TO TEXT (MIC) --------------------
  function addTimestampHeader() {
    const now = new Date();
    const stamp = now.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    setLeadNotes((prev) => {
      const header = `[${stamp}]`;
      if (!prev || !prev.trim()) return `${header}\n`;
      return `${prev.trim()}\n\n${header}\n`;
    });
  }

  function resetSilenceTimer() {
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    if (recordingRef.current) {
      silenceTimeoutRef.current = setTimeout(() => stopRecording(), 20000);
    }
  }

  function clearSilenceTimer() {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }

  function initRecognition() {
    if (typeof window === "undefined") return null;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice-to-text is not supported in this browser.");
      return null;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-AU";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalText += res[0].transcript + " ";
        }
        finalText = finalText.trim();
        if (!finalText) return;

        resetSilenceTimer();

        let text = finalText.replace(/\r?\n/g, " ");
        text = text.replace(/new paragraph/gi, "\n\n");
        text = text.replace(/new line/gi, "\n");
        text = text.replace(/full stop/gi, ".");
        text = text.replace(/\bcomma\b/gi, ",");
        text = text.replace(/\bquestion mark\b/gi, "?");
        text = text.replace(/\bexclamation mark\b/gi, "!");
        text = text.replace(/\bcolon\b/gi, ":");

        setLeadNotes((prevRaw) => {
          const prev = prevRaw || "";
          if (!prev) return text;

          const lastChar = prev.slice(-1);
          const firstChar = text[0];

          const needsSpace = ![" ", "\n"].includes(lastChar) && !["\n", ".", ",", "!", "?", ":"].includes(firstChar);

          return prev + (needsSpace ? " " : "") + text;
        });
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event);
      };

      recognition.onend = () => {
        clearSilenceTimer();
        if (recordingRef.current) {
          try {
            recognition.start();
            resetSilenceTimer();
          } catch (e) {
            console.error("Speech restart error:", e);
            recordingRef.current = false;
            setIsRecording(false);
          }
        } else {
          setIsRecording(false);
        }
      };

      recognitionRef.current = recognition;
    }

    return recognitionRef.current;
  }

  function startRecording() {
    const recognition = initRecognition();
    if (!recognition) return;

    if (recordingRef.current) return;
    recordingRef.current = true;
    setIsRecording(true);

    addTimestampHeader();

    try {
      recognition.start();
      resetSilenceTimer();
    } catch (e) {
      console.error("Speech start error:", e);
      recordingRef.current = false;
      setIsRecording(false);
    }
  }

  function stopRecording() {
    const recognition = recognitionRef.current;
    recordingRef.current = false;
    setIsRecording(false);
    clearSilenceTimer();

    if (!recognition) return;
    try {
      recognition.stop();
    } catch (e) {
      console.error("Speech stop error:", e);
    }
  }

  // -------------------- TASK HELPERS --------------------
  function getTaskTypeLabel(type) {
    switch (type) {
      case "phone_call":
        return "Phone call";
      case "text_message":
        return "Text message";
      case "zoom_call":
        return "Zoom call";
      case "whatsapp":
        return "WhatsApp";
      case "in_person":
        return "Meeting in person";
      default:
        return "Other";
    }
  }

  async function handleAddUpcomingTask() {
    if (!userId || !lead) {
      alert("No lead or user loaded.");
      return;
    }

    const text = newTaskText.trim();
    if (!text) {
      alert("Please add what the task is about.");
      return;
    }

    if (!newTaskDate) {
      alert("Please choose a date from the calendar.");
      return;
    }

    const timeString = newTaskTime || "09:00";
    const whenText = new Date(`${newTaskDate}T${timeString}:00`).toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const name = lead.name || "This contact";
    const typeLabel = getTaskTypeLabel(newTaskType);
    const title = `${name} – ${typeLabel} about: ${text} – ${whenText}`;

    const payload = {
      user_id: userId,
      contact_id: lead.id,
      title,
      notes: null,
      completed: false,
      due_date: newTaskDate,
    };

    const { data, error } = await supabase.from("crm_tasks").insert(payload).select().single();

    if (error) {
      console.error("Add upcoming task error:", error);
      alert("There was an error saving the task / reminder.");
      return;
    }

    setLeadTasks((prev) => [data, ...prev]);
    setNewTaskText("");
    setNewTaskDate("");
    setNewTaskTime("");
    setIsCalendarOpen(false);

    alert("Upcoming task added.");
  }

  // -------------------- CALENDAR --------------------
  const calendarYear = calendarMonth.getFullYear();
  const calendarMonthIndex = calendarMonth.getMonth();
  const firstOfMonth = new Date(calendarYear, calendarMonthIndex, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(calendarYear, calendarMonthIndex + 1, 0).getDate();

  const calendarCells = [];
  for (let i = 0; i < startWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

  function toISODate(day) {
    const dt = new Date(calendarYear, calendarMonthIndex, day);
    return dt.toISOString().slice(0, 10);
  }

  function goMonth(offset) {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const calendarLabel = calendarMonth.toLocaleString("en-AU", { month: "long", year: "numeric" });

  // -------------------- DRAG / RESIZE --------------------
  function handleModalHeaderMouseDown(e) {
    e.preventDefault();
    modalDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: modalOffset.x,
      originY: modalOffset.y,
    };
    setIsModalDragging(true);
  }

  function handleResizeMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    modalResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: modalSize.width,
      startHeight: modalSize.height,
    };
    setIsResizing(true);
  }

  // -------------------- ACTIONS --------------------
  function handleCloseInternal() {
    stopRecording();
    setIsCalendarOpen(false);
    setLeadTasks([]);
    setShowAutomation(false);
    if (onClose) onClose();
  }

  function goToSmsPage() {
    const base = "/modules/email/crm/sms-marketing";
    const qs = lead?.id ? `?lead_id=${encodeURIComponent(lead.id)}` : "";
    router.push(base + qs);
  }

  // Dialer number
  const leadPhone = s(lead.phone);
  const dialToNumber = useMemo(() => {
    const e164 = normalizePhoneE164AU(leadPhone);
    return e164 || leadPhone;
  }, [leadPhone]);

  const leadEmail = s(lead.email);

  // Audio URL resolver:
  // - recordingSid (RE...) -> /api/twilio/recording?sid=...
  // - recordingUrl -> /api/twilio/recording-audio?url=...
  function getAudioSrc(item) {
    const reSid = s(item?.recordingSid);
    const url = s(item?.recordingUrl);

    if (reSid && reSid.startsWith("RE")) {
      return `/api/twilio/recording?sid=${encodeURIComponent(reSid)}`;
    }
    if (url) {
      return `/api/twilio/recording-audio?url=${encodeURIComponent(url)}`;
    }
    return "";
  }

  function handleInsertRecordingTimestamp(rec) {
    const stamp = rec?.createdAt ? formatCallTime(rec.createdAt) : "";
    const dur = rec?.duration != null ? formatDurationSeconds(rec.duration) : "";
    const header = stamp ? `[${stamp}]` : "[Call Recording]";
    const suffix = dur ? ` (Duration ${dur})` : "";
    const line = `${header} 🎧 Call recording${suffix}`;

    setLeadNotes((prev) => {
      const p = String(prev || "").trim();
      if (!p) return `${line}\n`;
      return `${p}\n\n${line}\n`;
    });
  }

  return (
    <div style={styles.modalOverlay}>
      <div
        style={{
          ...styles.leadModal,
          border: `1px solid ${stageColor}`,
          marginTop: modalOffset.y,
          marginLeft: modalOffset.x,
          width: modalSize.width,
          height: modalSize.height,
          maxWidth: "95vw",
          maxHeight: "90vh",
          fontSize: scaled(16),
        }}
      >
        <div style={{ ...styles.leadModalHeader, background: stageColor }} onMouseDown={handleModalHeaderMouseDown}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 style={{ margin: 0, fontSize: scaled(18) }}>Lead Details – {lead.name || "Unnamed"}</h2>
            <div style={{ fontSize: scaled(12), opacity: 0.92 }}>
              {leadEmail ? `✉ ${leadEmail}` : ""} {leadEmail && leadPhone ? "  •  " : ""} {leadPhone ? `📞 ${leadPhone}` : ""}
            </div>
          </div>
          <span style={{ fontSize: scaled(11), opacity: 0.9 }}>drag this bar to move</span>
        </div>

        <div style={styles.leadModalColumns}>
          {/* LEFT */}
          <div style={styles.leadModalLeft}>
            <div style={{ ...styles.detailsBox, ...panelTint }}>
              <LeadInfoCard lead={lead} stageColor={stageColor} fontScale={fontScale * 0.8} />
            </div>

            <div style={{ ...styles.callsSection, ...panelTint }}>
              <div style={styles.callsHeaderRow}>
                <span style={styles.callsTitle}>📞 Calls &amp; Voicemails</span>
              </div>

              <div style={styles.callsPhoneRow}>
                <span style={styles.callsPhoneText}>{leadPhone || "No phone on file"}</span>
                {!!leadPhone && (
                  <button type="button" onClick={() => setShowDialer((p) => !p)} style={styles.smallToggleBtn} title="Show/Hide dialer">
                    {showDialer ? "Hide dialer" : "Show dialer"}
                  </button>
                )}
              </div>

              {showDialer && leadPhone && <BrowserDialer toNumber={dialToNumber} displayName={lead.name || ""} userId={userId} />}

              <div style={styles.smsNavRow}>
                <button type="button" onClick={goToSmsPage} style={styles.smsNavBtn}>
                  Send SMS →
                </button>
                <span style={styles.smsNavHelp}>Opens SMS Marketing page (no clutter here)</span>
              </div>
            </div>

            <div style={{ ...styles.tasksSection, ...panelTint }}>
              <div style={styles.tasksHeaderRow}>
                <span style={{ ...styles.tasksTitle, fontSize: scaled(14) }}>📌 Tasks &amp; reminders</span>
                {tasksLoading && <span style={{ ...styles.tasksLoading, fontSize: scaled(11) }}>Loading…</span>}
              </div>

              <div style={styles.taskList}>
                {leadTasks.length === 0 && !tasksLoading && <p style={{ ...styles.taskEmptyText, fontSize: scaled(12) }}>No tasks yet.</p>}

                {leadTasks.map((task) => (
                  <div key={task.id} style={styles.taskItem}>
                    <div style={styles.taskItemMain}>
                      <span style={{ ...styles.taskStatusDot, backgroundColor: task.completed ? "#22c55e" : "#f97316" }} />
                      <span style={{ ...styles.taskItemTitle, fontSize: scaled(13) }}>{task.title}</span>
                    </div>
                    <div style={styles.taskItemMeta}>
                      {task.due_date && (
                        <span style={{ ...styles.taskMetaChip, fontSize: scaled(11) }}>
                          Due: {new Date(task.due_date).toLocaleDateString("en-AU")}
                        </span>
                      )}
                      {task.completed && <span style={{ ...styles.taskMetaChip, fontSize: scaled(11) }}>Completed</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div style={styles.leadModalRight}>
            <div style={{ ...styles.notesBox, ...panelTint }}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: scaled(15) }}>Notes</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={addTimestampHeader}
                    style={{
                      ...styles.pillBtn,
                      background: "#0f172a",
                      fontSize: scaled(12),
                      border: "1px solid rgba(255,255,255,0.35)",
                    }}
                  >
                    + New note
                  </button>

                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    style={{
                      ...styles.pillBtn,
                      background: isRecording ? "#b91c1c" : stageColor,
                      fontSize: scaled(12),
                    }}
                  >
                    {isRecording ? "⏹ Stop Recording" : "🎙 Voice to Text"}
                  </button>
                </div>
              </label>

              {/* RECORDINGS TIMELINE (COMPACT, INSIDE NOTES BOX) */}
              <div style={styles.notesRecList}>
                {recError ? <div style={styles.notesRecError}>{recError}</div> : null}

                {!recError && mergedRecordings.length === 0 && !recLoading ? (
                  <div style={styles.notesRecEmpty}>No recordings found for this lead.</div>
                ) : null}

                {mergedRecordings.slice(0, 10).map((r) => {
                  const src = getAudioSrc(r);
                  const stamp = r.createdAt ? formatCallTime(r.createdAt) : "";
                  const dur = r.duration != null ? formatDurationSeconds(r.duration) : "";

                  return (
                    <div key={r.key} style={styles.notesRecItem}>
                      <div style={styles.notesRecTopRow}>
                        <span style={styles.notesRecMeta}>{stamp}</span>
                        <span style={styles.notesRecMeta}>{dur}</span>
                      </div>

                      <div style={styles.notesRecMidRow}>
                        <span style={styles.notesRecMetaSoft}>
                          {r.to ? `To: ${r.to}` : ""}
                          {r.to && r.from ? "  •  " : ""}
                          {r.from ? `From: ${r.from}` : ""}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleInsertRecordingTimestamp(r)}
                          style={styles.notesRecInsertBtn}
                          title="Insert a simple line into notes at the bottom (no SID, no junk)"
                        >
                          + add note line
                        </button>
                      </div>

                      {src ? (
                        <audio controls preload="metadata" style={styles.notesRecAudio} src={src} />
                      ) : (
                        <div style={styles.notesRecError}>Recording has no playable source (missing recording_url / recording sid).</div>
                      )}

                      <div style={styles.notesRecSourceRow}>
                        <span style={styles.notesRecSourceChip}>{r.source === "db" ? "Supabase" : "Twilio"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* NOTES TEXTAREA (ONLY USER NOTES) */}
              <textarea
                rows={10}
                style={{ ...styles.notesTextarea, fontSize: scaled(16) }}
                value={leadNotes}
                onChange={(e) => setLeadNotes(e.target.value)}
                placeholder="Type or use voice-to-text to record call notes..."
              />
            </div>

            <div style={{ ...styles.addTaskSection, ...panelTint }}>
              <h3 style={{ margin: "0 0 8px", fontSize: scaled(15) }}>📌 Add upcoming task</h3>

              <div style={styles.addTaskRowTop}>
                <select value={newTaskType} onChange={(e) => setNewTaskType(e.target.value)} style={{ ...styles.taskTypeSelect, fontSize: scaled(12) }}>
                  <option value="phone_call">Phone call</option>
                  <option value="text_message">Text message</option>
                  <option value="zoom_call">Zoom call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="in_person">Meeting in person</option>
                  <option value="other">Other</option>
                </select>

                <input
                  type="text"
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  style={{ ...styles.addTaskTextInput, fontSize: scaled(12) }}
                  placeholder="e.g. Call lead about follow-up"
                />
              </div>

              <div style={styles.addTaskRowBottom}>
                <div style={styles.calendarPicker}>
                  <button type="button" onClick={() => setIsCalendarOpen((prev) => !prev)} style={{ ...styles.calendarTrigger, fontSize: scaled(12) }}>
                    {newTaskDate ? new Date(newTaskDate).toLocaleDateString("en-AU") : "Select date"}
                  </button>

                  {isCalendarOpen && (
                    <div style={styles.calendarPopover}>
                      <div style={styles.calendarHeader}>
                        <button type="button" onClick={() => goMonth(-1)} style={styles.calendarNavBtn}>
                          ◀
                        </button>
                        <span style={styles.calendarHeaderLabel}>{calendarLabel}</span>
                        <button type="button" onClick={() => goMonth(1)} style={styles.calendarNavBtn}>
                          ▶
                        </button>
                      </div>

                      <div style={styles.calendarWeekdays}>
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <span key={d} style={styles.calendarWeekday}>
                            {d}
                          </span>
                        ))}
                      </div>

                      <div style={styles.calendarGrid}>
                        {calendarCells.map((day, idx) => {
                          if (!day) return <span key={idx} style={styles.calendarEmptyCell} />;

                          const iso = toISODate(day);
                          const isToday = iso === todayStr;
                          const isSelected = iso === newTaskDate;

                          return (
                            <button
                              type="button"
                              key={idx}
                              onClick={() => {
                                setNewTaskDate(iso);
                                setIsCalendarOpen(false);
                              }}
                              style={{
                                ...styles.calendarDayBtn,
                                ...(isSelected ? styles.calendarDaySelected : {}),
                                ...(isToday ? styles.calendarDayToday : {}),
                              }}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <input type="time" value={newTaskTime} onChange={(e) => setNewTaskTime(e.target.value)} style={{ ...styles.addTaskTimeInput, fontSize: scaled(12) }} />

                <button type="button" onClick={handleAddUpcomingTask} style={{ ...styles.addTaskBtn, fontSize: scaled(12) }}>
                  + Save task
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.footerBar}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => alert("Add to CRM is already active for this lead.")}
              style={{
                ...styles.footerBtn,
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.45)",
              }}
              disabled={!lead?.id}
              title="Add to CRM"
            >
              Add to CRM
            </button>

            <button
              id="gr8-automation-toggle"
              type="button"
              onClick={() => setShowAutomation((p) => !p)}
              style={{
                ...styles.footerBtn,
                background: "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.45)",
              }}
              disabled={!lead?.id}
              title="Send this lead into an Automation Flow"
            >
              Send to Automation
            </button>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleCloseInternal} style={{ ...styles.backBtn2, fontSize: scaled(12) }} disabled={isRecording}>
              Close
            </button>
            <button onClick={handleSaveLeadNotes} style={{ ...styles.saveBtn, fontSize: scaled(12) }}>
              Save Notes
            </button>
          </div>
        </div>

        {showAutomation && (
          <div id="gr8-automation-popover" style={styles.automationPopover}>
            <div style={styles.automationPopoverHeader}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#e5e7eb" }}>Send to Automation</div>
              <button type="button" onClick={() => setShowAutomation(false)} style={styles.automationPopoverX} title="Close">
                ×
              </button>
            </div>
            <div style={styles.automationPopoverBody}>
              <SendToAutomationPanel leadId={lead?.id} onSent={() => setShowAutomation(false)} />
            </div>
          </div>
        )}

        <div style={styles.resizeHandle} onMouseDown={handleResizeMouseDown} title="Drag to resize" />
      </div>
    </div>
  );
}

const styles = {
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },

  leadModal: {
    background: "#020617",
    borderRadius: "14px",
    boxShadow: "0 20px 40px rgba(0,0,0,0.7)",
    overflow: "hidden",
    position: "relative",
    display: "flex",
    flexDirection: "column",
  },

  leadModalHeader: {
    padding: "10px 16px",
    borderTopLeftRadius: "14px",
    borderTopRightRadius: "14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "grab",
  },

  leadModalColumns: {
    display: "grid",
    gridTemplateColumns: "1fr 2fr",
    gap: "22px",
    padding: "18px 20px 12px",
    flex: 1,
    minHeight: 0,
  },

  leadModalLeft: {
    borderRight: "1px solid #1f2937",
    paddingRight: "12px",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    gap: 10,
  },

  leadModalRight: {
    paddingLeft: "4px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    height: "100%",
    minHeight: 0,
  },

  detailsBox: {
    padding: 0,
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid rgba(148,163,184,0.4)",
    background: "rgba(15,23,42,0.95)",
  },

  callsSection: {
    padding: "10px 10px 10px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.95)",
    border: "1px dashed #1f2937",
  },

  callsHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },

  callsTitle: { fontSize: 16, fontWeight: 600, opacity: 0.9 },

  callsPhoneRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },

  callsPhoneText: { fontSize: 14, opacity: 0.85 },

  smallToggleBtn: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(2,6,23,0.6)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
    whiteSpace: "nowrap",
  },

  smsNavRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(148,163,184,0.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  smsNavBtn: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(34,197,94,0.45)",
    background: "rgba(34,197,94,0.14)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  },

  smsNavHelp: { fontSize: 12, color: "#94a3b8" },

  notesBox: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.95)",
    border: "1px solid rgba(148,163,184,0.4)",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },

  pillBtn: {
    border: "none",
    borderRadius: 999,
    padding: "6px 14px",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },

  notesRecList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 10,
  },

  notesRecError: {
    fontSize: 12,
    fontWeight: 800,
    color: "#fecaca",
    opacity: 0.95,
  },

  notesRecEmpty: {
    fontSize: 12,
    fontWeight: 800,
    color: "#94a3b8",
    opacity: 0.95,
    padding: "6px 2px",
  },

  notesRecItem: {
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.14)",
    background: "rgba(2,6,23,0.45)",
    padding: "8px 10px",
  },

  notesRecTopRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },

  notesRecMidRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },

  notesRecMeta: {
    fontSize: 12,
    fontWeight: 800,
    color: "#e5e7eb",
    opacity: 0.88,
    minHeight: 16,
  },

  notesRecMetaSoft: {
    fontSize: 12,
    fontWeight: 800,
    color: "#e5e7eb",
    opacity: 0.72,
    minHeight: 16,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "70%",
  },

  notesRecInsertBtn: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(2,6,23,0.6)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 11,
    whiteSpace: "nowrap",
  },

  notesRecAudio: {
    width: "100%",
    height: 28,
  },

  notesRecSourceRow: {
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },

  notesRecSourceChip: {
    fontSize: 11,
    fontWeight: 900,
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(148,163,184,0.18)",
    color: "#e5e7eb",
  },

  notesTextarea: {
    width: "100%",
    borderRadius: "10px",
    border: "1px solid #4b5563",
    padding: "10px 12px",
    background: "#020617",
    color: "#fff",
    lineHeight: 1.5,
    flex: 1,
    minHeight: 0,
    height: "100%",
    resize: "none",
    fontFamily: 'Arial, "Helvetica Neue", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  addTaskSection: {
    marginTop: "auto",
    padding: "10px 12px 12px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.95)",
    border: "1px solid rgba(148,163,184,0.4)",
  },

  addTaskRowTop: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 0.7fr) minmax(0, 1.3fr)",
    gap: 8,
    marginBottom: 8,
  },

  addTaskRowBottom: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr) auto",
    gap: 8,
    marginBottom: 4,
  },

  taskTypeSelect: {
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #4b5563",
    background: "#020617",
    color: "#fff",
  },

  addTaskTextInput: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #4b5563",
    background: "#020617",
    color: "#fff",
  },

  addTaskTimeInput: {
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #4b5563",
    background: "#020617",
    color: "#fff",
  },

  addTaskBtn: {
    borderRadius: 8,
    border: "none",
    padding: "6px 10px",
    background: "#22c55e",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  calendarPicker: { position: "relative" },

  calendarTrigger: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #4b5563",
    background: "#020617",
    color: "#fff",
    textAlign: "left",
    cursor: "pointer",
  },

  calendarPopover: {
    position: "absolute",
    bottom: "110%",
    left: 0,
    zIndex: 9999,
    background: "#020617",
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.6)",
    boxShadow: "0 14px 30px rgba(0,0,0,0.7)",
    padding: 8,
    width: 230,
  },

  calendarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  calendarHeaderLabel: { fontSize: 12, fontWeight: 700 },

  calendarNavBtn: {
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.6)",
    padding: "2px 6px",
    background: "transparent",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: 11,
  },

  calendarWeekdays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 2,
    marginBottom: 2,
  },

  calendarWeekday: { fontSize: 10, textAlign: "center", opacity: 0.7 },

  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 2,
  },

  calendarEmptyCell: { height: 26 },

  calendarDayBtn: {
    height: 26,
    borderRadius: 6,
    border: "1px solid transparent",
    background: "rgba(15,23,42,0.95)",
    color: "#e5e7eb",
    fontSize: 11,
    cursor: "pointer",
  },

  calendarDaySelected: {
    background: "#22c55e",
    borderColor: "#22c55e",
    color: "#fff",
    fontWeight: 900,
  },

  calendarDayToday: {
    boxShadow: "0 0 0 1px #0ea5e9 inset",
  },

  tasksSection: {
    padding: "10px 10px 8px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.95)",
    border: "1px dashed #1f2937",
  },

  tasksHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },

  tasksTitle: { fontSize: 14, fontWeight: 700, opacity: 0.9 },
  tasksLoading: { fontSize: 12, opacity: 0.7 },

  taskList: {
    marginTop: 4,
    maxHeight: 240,
    overflowY: "auto",
    paddingRight: 4,
  },

  taskEmptyText: { fontSize: 12, opacity: 0.7, margin: 0 },

  taskItem: {
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #1f2937",
    background: "#020617",
    marginBottom: 6,
  },

  taskItemMain: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },

  taskStatusDot: { width: 8, height: 8, borderRadius: "999px" },
  taskItemTitle: { fontSize: 13 },
  taskItemMeta: { display: "flex", flexWrap: "wrap", gap: 6 },

  taskMetaChip: {
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 999,
    background: "rgba(148,163,184,0.2)",
  },

  footerBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px 12px",
    borderTop: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(2,6,23,0.85)",
  },

  footerBtn: {
    padding: "8px 12px",
    borderRadius: 10,
    background: "transparent",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  },

  backBtn2: {
    background: "rgba(255,255,255,0.18)",
    borderRadius: "10px",
    padding: "8px 14px",
    color: "#fff",
    cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.16)",
    fontSize: 13,
    fontWeight: 800,
  },

  saveBtn: {
    background: "#3b82f6",
    border: "none",
    borderRadius: "10px",
    padding: "8px 14px",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 13,
  },

  automationPopover: {
    position: "absolute",
    left: 16,
    bottom: 64,
    width: 420,
    maxWidth: "calc(100% - 32px)",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(2,6,23,0.96)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
    zIndex: 9999,
    overflow: "hidden",
  },

  automationPopoverHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid rgba(148,163,184,0.18)",
  },

  automationPopoverX: {
    background: "transparent",
    border: "none",
    color: "#cbd5e1",
    fontSize: 22,
    cursor: "pointer",
    lineHeight: 1,
  },

  automationPopoverBody: {
    padding: 10,
  },

  resizeHandle: {
    position: "absolute",
    width: "16px",
    height: "16px",
    right: "8px",
    bottom: "8px",
    borderRadius: "4px",
    border: "1px solid #4b5563",
    background: "rgba(15,23,42,0.9)",
    cursor: "se-resize",
  },
};

