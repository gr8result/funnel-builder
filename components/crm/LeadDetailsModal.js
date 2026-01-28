import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../utils/supabase-client";
import LeadInfoCard from "./LeadInfoCard";
import BrowserDialer from "../telephony/BrowserDialer";
import SendToAutomationPanel from "./SendToAutomationPanel";

/*
  Full replacement: components/crm/LeadDetailsModal.js

  Behavior:
  - Single continuous timeline (notes + calls) newest-first.
  - Editor (draft textarea) hidden by default; shown with "+ New note".
  - Voice opens editor if closed, inserts transcription into draft at caret.
  - Saving prepends draft into saved history (historyNotes), persists cleaned (stripCallJunk).
  - Calls are imported from server API and from the crm_calls table. loadLeadCalls includes rows where:
      * lead_id === lead.id OR
      * from_number / to_number matches the lead phone (normalized)
    and deduplicates by recording_sid / id / created_at.
  - Polls for new calls every 10s while modal is open; also refreshes after recording stops and after saves.
  - Audio players use either a sid-based proxy (/api/twilio/recording?sid=...) or url-proxy (/api/twilio/recording-audio?url=...).
*/

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

  const scaled = (v) => Math.round(v * fontScale);
  const s = (v) => String(v ?? "").trim();

  // ---------------- Helpers ----------------
  function normalizePhoneE164AU(raw) {
    let v = s(raw);
    if (!v) return "";
    v = v.replace(/[^\d+]/g, "");
    if (!v) return "";
    if (!v.startsWith("+") && v.startsWith("61")) v = "+" + v;
    if (!v.startsWith("+") && v.startsWith("0") && v.length >= 9) v = "+61" + v.slice(1);
    return v;
  }

  function fmtDateTime(value) {
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

  function fmtDuration(value) {
    if (value == null) return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const secs = Math.max(0, Math.round(n));
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const rem = secs % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}h ${remM}m`;
    }
    return `${m}m ${rem}s`;
  }

  function extractRecordingSidFromUrl(url) {
    const u = s(url);
    if (!u) return "";
    const m = u.match(/\/Recordings\/(RE[a-zA-Z0-9]+)(?:\.json|\.mp3)?/);
    return m?.[1] || "";
  }

  function stripCallJunk(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);
    const out = [];
    let skipping = false;

    for (const line of lines) {
      const l = line.trim();
      if (/^Call recording ready/i.test(l)) {
        skipping = true;
        continue;
      }
      if (skipping) {
        if (!l) skipping = false;
        continue;
      }
      if (/^REC:\s*/i.test(l)) continue;
      if (/\[REC:.*\]/i.test(l)) continue;
      if (/\[RECURL:.*\]/i.test(l)) continue;
      if (/^(To:|From:|CallSid:|RecordingSid:|Duration:|Status:|Recording:)/i.test(l)) continue;
      out.push(line);
    }

    return out.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd();
  }

  // ---------------- UI tint ----------------
  const stageColor = stages.find((st) => st.id === lead.stage)?.color || "#3b82f6";
  const panelTint = { background: `linear-gradient(135deg, rgba(15,23,42,0.98), ${stageColor}33)` };

  // ---------------- Refs & State ----------------
  const editorRef = useRef(null);

  const [historyNotes, setHistoryNotes] = useState(() => stripCallJunk(lead.notes || ""));
  const [editorContent, setEditorContent] = useState("");
  const [showEditor, setShowEditor] = useState(false);

  const [leadTasks, setLeadTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  const [newTaskType, setNewTaskType] = useState("phone_call");
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const recordingRef = useRef(false);
  const silenceTimeoutRef = useRef(null);

  const [showDialer, setShowDialer] = useState(true);

  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState("");
  const [calls, setCalls] = useState([]);

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const [showAutomation, setShowAutomation] = useState(false);

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

  const [justAddedHeader, setJustAddedHeader] = useState(false);

  // ---------------- Effects ----------------
  useEffect(() => {
    if (!isOpen || !lead || !userId) return;

    const initial = stripCallJunk(lead.notes || "");
    setHistoryNotes(initial);
    setEditorContent("");
    setShowEditor(false);
    if (editorRef.current) editorRef.current.value = "";

    setLeadTasks([]);
    setNewTaskText("");
    setNewTaskDate("");
    setNewTaskTime("");
    setIsCalendarOpen(false);
    setShowDialer(true);
    setShowAutomation(false);

    setCallError("");
    setCalls([]);

    setModalOffset({ x: 0, y: 0 });
    setModalSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

    loadTasksForLead(lead.id);

    loadLeadCalls();
    const t1 = setTimeout(() => loadLeadCalls(), 6000);
    const t2 = setTimeout(() => loadLeadCalls(), 15000);
    const t3 = setTimeout(() => loadLeadCalls(), 30000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lead?.id, userId]);

  useEffect(() => {
    if (!isOpen || !lead?.id) return undefined;
    const iv = setInterval(() => {
      loadLeadCalls();
    }, 10000);
    return () => clearInterval(iv);
  }, [isOpen, lead?.id]);

  useEffect(() => {
    if (!justAddedHeader) return;
    requestAnimationFrame(() => {
      try {
        if (editorRef.current) {
          const val = editorRef.current.value || "";
          const firstNewline = val.indexOf("\n");
          let pos = 0;
          if (firstNewline >= 0) {
            if (val[firstNewline + 1] === "\n") pos = firstNewline + 2;
            else pos = firstNewline + 1;
          } else {
            pos = val.length;
          }
          editorRef.current.selectionStart = editorRef.current.selectionEnd = pos;
          editorRef.current.focus();
        }
      } catch (e) {}
      setJustAddedHeader(false);
    });
  }, [justAddedHeader]);

  useEffect(() => {
    function handleMouseMove(e) {
      if (isModalDragging) {
        const { startX, startY, originX, originY } = modalDragRef.current;
        setModalOffset({
          x: originX + (e.clientX - startX),
          y: originY + (e.clientY - startY),
        });
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

  // ---------------- DB helpers ----------------
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

  // loadLeadCalls: include rows where lead_id matches OR phone matches lead.phone (AU-normalize),
  // deduplicate results, merge API and DB sources.
  async function loadLeadCalls() {
    try {
      if (!lead?.id) return;

      setCallLoading(true);
      setCallError("");

      let apiCalls = [];
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token || "";
        if (token) {
          const r = await fetch(
            `/api/crm/lead-call-recordings?lead_id=${encodeURIComponent(lead.id)}&limit=200`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const j = await r.json().catch(() => ({}));
          if (j?.ok && Array.isArray(j.calls)) apiCalls = j.calls;
          else if (j?.ok && Array.isArray(j.recordings)) apiCalls = j.recordings;
        }
      } catch (err) {
        console.warn("API fetch failed:", err);
      }

      let dbCalls = [];
      try {
        const { data: byLeadId, error: e1 } = await supabase
          .from("crm_calls")
          .select(
            "id, created_at, direction, from_number, to_number, recording_url, recording_sid, twilio_sid, recording_duration, duration, lead_id, caller_name"
          )
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(500);

        if (!e1 && Array.isArray(byLeadId)) dbCalls = byLeadId;
      } catch (err) {
        console.error("Supabase crm_calls (by lead_id) error:", err);
      }

      try {
        const leadPhoneNorm = normalizePhoneE164AU(lead.phone || "");
        if (leadPhoneNorm) {
          const { data: recent, error: e2 } = await supabase
            .from("crm_calls")
            .select(
              "id, created_at, direction, from_number, to_number, recording_url, recording_sid, twilio_sid, recording_duration, duration, lead_id, caller_name"
            )
            .order("created_at", { ascending: false })
            .limit(500);

          if (!e2 && Array.isArray(recent)) {
            const norm = (num) => {
              if (!num) return "";
              const n = String(num).replace(/[^\d+]/g, "");
              if (!n.startsWith("+") && n.startsWith("61")) return "+" + n;
              if (!n.startsWith("+") && n.startsWith("0") && n.length >= 9) return "+61" + n.slice(1);
              return n;
            };
            for (const r of recent) {
              const fn = norm(r.from_number || r.from);
              const tn = norm(r.to_number || r.to);
              if (fn === leadPhoneNorm || tn === leadPhoneNorm) {
                if (!dbCalls.find((c) => String(c.id) === String(r.id))) dbCalls.push(r);
              }
            }
          }
        }
      } catch (err) {
        console.error("Supabase crm_calls (phone match) error:", err);
      }

      const normalizedDb = (dbCalls || []).map((c) => ({
        id: c.id,
        created_at: c.created_at,
        direction: c.direction,
        from_number: c.from_number || c.from || "",
        to_number: c.to_number || c.to || "",
        recording_url: c.recording_url || "",
        recording_sid: c.recording_sid || c.twilio_sid || "",
        duration: c.recording_duration || c.duration || null,
        caller_name: c.caller_name || "",
        raw: c,
      }));

      let mergedCalls = [];
      if (apiCalls.length > 0) {
        const byKey = {};
        for (const d of normalizedDb) {
          const key = d.recording_sid || d.id || (d.created_at ? new Date(d.created_at).toISOString() : "");
          if (key) byKey[key] = d;
        }
        for (const a of apiCalls) {
          const aCreated = a.created_at ? new Date(a.created_at).toISOString() : "";
          const matchKey = a.recording_sid || a.sid || extractRecordingSidFromUrl(a.recording_url) || (a.id || "");
          const dbMatch =
            byKey[matchKey] ||
            normalizedDb.find((d) => {
              const da = d.created_at ? new Date(d.created_at).toISOString() : "";
              return da === aCreated || String(d.id) === String(a.id);
            });
          if (dbMatch) {
            mergedCalls.push({
              ...dbMatch,
              recording_url: a.recording_url || dbMatch.recording_url,
              recording_sid: a.recording_sid || dbMatch.recording_sid,
              duration: a.duration || dbMatch.duration,
              _api: a,
            });
          } else {
            mergedCalls.push({
              id: a.id || null,
              created_at: a.created_at || a.date_created || a.created || null,
              direction: a.direction || a.call_direction || "",
              from_number: a.from || a.from_number || "",
              to_number: a.to || a.to_number || "",
              recording_url: a.recording_url || a.url || "",
              recording_sid: a.recording_sid || a.sid || extractRecordingSidFromUrl(a.recording_url) || "",
              duration: a.duration || a.recording_duration || null,
              caller_name: a.caller_name || "",
              raw: a,
            });
          }
        }
      } else {
        mergedCalls = normalizedDb;
      }

      const seen = new Set();
      const deduped = [];
      for (const c of mergedCalls) {
        const key = c.recording_sid || c.id || (c.created_at ? new Date(c.created_at).toISOString() : "");
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
      }

      const outbound = (deduped || []).sort((a, b) => {
        const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });

      setCalls(outbound);
      setCallLoading(false);
    } catch (e) {
      console.error("loadLeadCalls error:", e);
      setCalls([]);
      setCallError(e?.message || "Failed to load calls.");
      setCallLoading(false);
    }
  }

  function getAudioSrc(call) {
    const sid = s(call?.recording_sid) || s(call?.twilio_sid) || extractRecordingSidFromUrl(call?.recording_url);
    const url = s(call?.recording_url || call?.recordingUrl || "");
    if (url.startsWith("/api/twilio/recording?sid=")) return url;
    if (url.startsWith("/api/twilio/recording-audio?url=")) return url;
    if (sid && sid.startsWith("RE")) return `/api/twilio/recording?sid=${encodeURIComponent(sid)}`;
    if (url) return `/api/twilio/recording-audio?url=${encodeURIComponent(url)}`;
    return "";
  }

  // ---------------- Voice-to-text ----------------
  function resetSilenceTimer() {
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    if (recordingRef.current) silenceTimeoutRef.current = setTimeout(() => stopRecording(), 20000);
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

        setEditorContent((prevRaw) => {
          const prev = prevRaw || "";
          let startPos = prev.length;
          try {
            if (editorRef.current && typeof editorRef.current.selectionStart === "number") {
              startPos = editorRef.current.selectionStart;
            }
          } catch (e) {
            startPos = prev.length;
          }

          const before = prev.slice(0, startPos);
          const after = prev.slice(startPos);

          const needsSpace =
            before &&
            ![" ", "\n"].includes(before.slice(-1)) &&
            !["\n", ".", ",", "!", "?", ":"].includes(text[0]);

          const insert = (needsSpace ? " " : "") + text;
          const newVal = before + insert + after;

          setTimeout(() => {
            try {
              if (editorRef.current) {
                editorRef.current.value = newVal;
                const newPos = startPos + insert.length;
                editorRef.current.selectionStart = editorRef.current.selectionEnd = newPos;
                editorRef.current.focus();
              }
            } catch (e) {}
          }, 0);

          return newVal;
        });
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          alert("Microphone access denied. Please allow microphone permission and try again.");
        }
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
    const header = `[${stamp}]`;

    if (!showEditor) setShowEditor(true);

    setEditorContent((prev) => {
      const v = String(prev || "");
      if (!v.trim()) {
        setJustAddedHeader(true);
        return `${header}\n`;
      }
      setJustAddedHeader(true);
      return `${header}\n\n${v}`;
    });
  }

  function startRecording() {
    const recognition = initRecognition();
    if (!recognition) return;
    if (recordingRef.current) return;

    if (!showEditor) setShowEditor(true);
    if (!editorContent || !/^\[.*\]/.test((editorContent || "").trim().split("\n")[0] || "")) {
      addTimestampHeader();
    } else {
      setTimeout(() => {
        try { if (editorRef.current) editorRef.current.focus(); } catch (e) {}
      }, 0);
    }

    recordingRef.current = true;
    setIsRecording(true);

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

    setTimeout(() => loadLeadCalls(), 1500);
    setTimeout(() => loadLeadCalls(), 5000);
    setTimeout(() => loadLeadCalls(), 12000);
  }

  // ---------------- Notes parsing for timeline ----------------
  function parseNotesIntoEntries(notesText) {
    const raw = String(notesText || "").replace(/\r/g, "");
    if (!raw) return [];

    const lines = raw.split("\n");
    const entries = [];
    let current = { header: null, created_at: null, lines: [] };

    const tryParseDateFromHeader = (hdr) => {
      const inner = hdr.replace(/^\[|\]$/g, "").trim();
      const d = new Date(inner);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
      return null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (/^\[.*\]$/.test(line)) {
        if (current.header || current.lines.length > 0) {
          entries.push({
            type: "note",
            header: current.header,
            created_at: current.created_at,
            text: current.lines.join("\n").trim(),
          });
        }
        const created = tryParseDateFromHeader(line);
        current = { header: line, created_at: created, lines: [] };
      } else {
        current.lines.push(line);
      }
    }
    if (current.header || current.lines.length > 0) {
      entries.push({
        type: "note",
        header: current.header,
        created_at: current.created_at,
        text: current.lines.join("\n").trim(),
      });
    }

    if (entries.length === 0 && raw) {
      entries.push({
        type: "note",
        header: null,
        created_at: null,
        text: raw.trim(),
      });
    }

    return entries;
  }

  const timeline = useMemo(() => {
    try {
      const noteEntries = parseNotesIntoEntries(historyNotes || "").map((n, i) => ({
        kind: "note",
        id: `note-${i}-${n.created_at || ""}`,
        created_at: n.created_at ? new Date(n.created_at).toISOString() : null,
        header: n.header,
        text: n.text,
      }));

      const callsNormalized = (calls || []).map((c, i) => ({
        kind: "call",
        id: `call-${c.id || i}-${c.created_at || ""}`,
        created_at: c?.created_at ? new Date(c.created_at).toISOString() : null,
        call: c,
      }));

      const merged = [...noteEntries, ...callsNormalized].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : -1;
        const tb = b.created_at ? new Date(b.created_at).getTime() : -1;
        return tb - ta;
      });

      return merged;
    } catch (e) {
      return [];
    }
  }, [historyNotes, calls]);

  // ---------------- Tasks & saving ----------------
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
    const text = (newTaskText || "").trim();
    if (!text) {
      alert("Please add what the task is about.");
      return;
    }
    if (!newTaskDate) {
      alert("Please choose a date from the calendar.");
      return;
    }

    const timeString = newTaskTime || "09:00";
    const whenText = new Date(`${newTaskDate}T${timeString}:00`).toLocaleDateString("en-AU", {
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

  async function handleSaveLeadNotes() {
    if (!lead) return;

    const draft = String(editorContent || "").trim();
    if (!draft) {
      alert("Please write a note before saving.");
      return;
    }

    const combined = `${draft}\n\n${historyNotes || ""}`;
    const clean = stripCallJunk(combined);

    try {
      const { error } = await supabase
        .from("leads")
        .update({ notes: clean, updated_at: new Date() })
        .eq("id", lead.id);

      if (error) {
        console.error("Save notes error:", error);
        alert("There was an error saving notes.");
        return;
      }

      setHistoryNotes(clean);
      setEditorContent("");
      setShowEditor(false);

      setTimeout(() => loadLeadCalls(), 1500);
      setTimeout(() => loadLeadCalls(), 5000);

      if (onNotesUpdated) onNotesUpdated(lead.id, clean);
      alert("Notes saved.");
      handleCloseInternal();
    } catch (err) {
      console.error("Save notes error:", err);
      alert("There was an error saving notes.");
    }
  }

  function handleCloseInternal() {
    stopRecording();
    setIsCalendarOpen(false);
    setLeadTasks([]);
    setShowAutomation(false);
    if (onClose) onClose();
  }

  // ---------------- Calendar helpers ----------------
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
  const calendarLabel = calendarMonth.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

  // ---------------- Render ----------------
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
        <div style={{ ...styles.leadModalHeader, background: stageColor }} onMouseDown={(e) => {
          e.preventDefault();
          modalDragRef.current = { startX: e.clientX, startY: e.clientY, originX: modalOffset.x, originY: modalOffset.y };
          setIsModalDragging(true);
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 style={{ margin: 0, fontSize: scaled(18) }}>Lead Details – {lead.name || "Unnamed"}</h2>
            <div style={{ fontSize: scaled(12), opacity: 0.92 }}>
              {lead.email ? `✉ ${lead.email}` : ""}{lead.email && lead.phone ? " • " : ""}{lead.phone ? `📞 ${lead.phone}` : ""}
            </div>
          </div>
          <span style={{ fontSize: scaled(11), opacity: 0.9 }}>drag this bar to move</span>
        </div>

        <div style={styles.leadModalColumns}>
          <div style={{ ...styles.leadModalLeft, overflowY: "auto" }}>
            <div style={{ ...styles.detailsBox, ...panelTint, overflowY: "auto" }}>
              <LeadInfoCard lead={lead} stageColor={stageColor} fontScale={fontScale * 0.8} />
            </div>

            <div style={{ ...styles.callsSection, ...panelTint }}>
              <div style={styles.callsHeaderRow}>
                <span style={styles.callsTitle}>📞 Calls &amp; Voicemails</span>
              </div>

              <div style={styles.callsPhoneRow}>
                <span style={styles.callsPhoneText}>{lead.phone || "No phone on file"}</span>
                {!!lead.phone && (
                  <button type="button" onClick={() => setShowDialer((p) => !p)} style={styles.smallToggleBtn} title="Show/Hide dialer">
                    {showDialer ? "Hide dialer" : "Show dialer"}
                  </button>
                )}
              </div>

              {showDialer && lead.phone && (
                <BrowserDialer toNumber={normalizePhoneE164AU(lead.phone)} displayName={lead.name || ""} userId={userId} />
              )}

              <div style={styles.smsNavRow}>
                <button type="button" onClick={() => router.push("/modules/email/crm/sms-marketing")} style={styles.smsNavBtn}>
                  Send SMS →
                </button>
                <span style={styles.smsNavHelp}>Opens SMS Marketing page (no clutter here)</span>
              </div>
            </div>

            <div style={{ ...styles.tasksSection, ...panelTint }}>
              <div style={styles.tasksHeaderRow}>
                <span style={{ ...styles.tasksTitle, fontSize: scaled(16) }}>📌 Tasks &amp; reminders</span>
                {tasksLoading && <span style={{ ...styles.tasksLoading, fontSize: scaled(16) }}>Loading…</span>}
              </div>

              <div style={styles.taskList}>
                {leadTasks.length === 0 && !tasksLoading && (
                  <p style={{ ...styles.taskEmptyText, fontSize: scaled(12) }}>No tasks yet.</p>
                )}

                {leadTasks.map((task) => (
                  <div key={task.id} style={styles.taskItem}>
                    <div style={styles.taskItemMain}>
                      <span style={{ ...styles.taskStatusDot, backgroundColor: task.completed ? "#22c55e" : "#f97316" }} />
                      <span style={{ ...styles.taskItemTitle, fontSize: scaled(16) }}>{task.title}</span>
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

          <div style={{ ...styles.leadModalRight }}>
            <div style={{ ...styles.notesBox, ...panelTint, display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
                <span style={{ fontWeight: 600, fontSize: scaled(15) }}>Notes</span>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {callLoading ? <span style={{ fontSize: scaled(12), color: "#cbd5e1", opacity: 0.9 }}>Loading…</span> : null}

                  <button
                    type="button"
                    onClick={() => {
                      if (!showEditor) {
                        setShowEditor(true);
                        setTimeout(addTimestampHeader, 0);
                      } else {
                        setShowEditor(false);
                      }
                    }}
                    style={{
                      ...styles.pillBtn,
                      background: "#0f172a",
                      fontSize: scaled(12),
                      border: "1px solid rgba(255,255,255,0.35)",
                    }}
                  >
                    {showEditor ? "Hide note" : "+ New note"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!showEditor) setShowEditor(true);
                      startRecording();
                    }}
                    style={{
                      ...styles.pillBtn,
                      background: isRecording ? "#b91c1c" : stageColor,
                      fontSize: scaled(12),
                    }}
                  >
                    {isRecording ? "⏹ Stop" : "🎙 Voice"}
                  </button>

                  <button type="button" onClick={() => loadLeadCalls()} style={styles.recordingsRefreshBtn}>
                    🔄
                  </button>
                </div>
              </div>

              {showEditor && (
                <div style={{ marginBottom: 10 }}>
                  <textarea
                    ref={editorRef}
                    rows={4}
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    placeholder="Type a new note here..."
                    style={{ ...styles.notesTextarea, fontSize: scaled(14), marginBottom: 10 }}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" onClick={() => { setEditorContent(""); setShowEditor(false); }} style={styles.backBtn2}>
                      Cancel
                    </button>
                    <button type="button" onClick={handleSaveLeadNotes} style={styles.saveBtn}>
                      Save Note
                    </button>
                  </div>
                </div>
              )}

              <div style={styles.entriesList}>
                {timeline.length === 0 && !callLoading ? <div style={styles.recordingsEmpty}>No activity yet.</div> : null}

                {timeline.map((entry, idx) => {
                  if (entry.kind === "note") {
                    const headerText = entry.header || "";
                    const bodyText = entry.text || "";
                    return (
                      <div key={entry.id || `note-${idx}`} style={styles.timelineRow}>
                        <div style={{ color: "#93c5fd", fontWeight: 700, marginRight: 8, whiteSpace: "nowrap" }}>
                          {headerText}
                        </div>
                        <div style={{ color: "#e5e7eb", whiteSpace: "pre-wrap", flex: 1 }}>{bodyText}</div>
                      </div>
                    );
                  }

                  if (entry.kind === "call") {
                    const c = entry.call;
                    const when = c?.created_at ? fmtDateTime(c.created_at) : "";
                    const dir = String(c?.direction || "").toUpperCase();
                    const fromN = s(c?.from_number || c?.from || "");
                    const toN = s(c?.to_number || c?.to || "");
                    const dur = c?.duration != null ? fmtDuration(c.duration) : "";
                    const audioSrc = getAudioSrc(c);

                    return (
                      <div key={entry.id || `call-${idx}`} style={styles.timelineRow}>
                        <div style={{ color: "#93c5fd", fontWeight: 700, marginRight: 8, whiteSpace: "nowrap" }}>
                          [{when}]
                        </div>

                        <div style={{ color: "#e5e7eb", display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                          <div style={{ minWidth: 180, fontWeight: 700 }}>{dir} {fromN} → {toN} {dur ? `(${dur})` : ""}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ color: "#cbd5e1", fontWeight: 700 }}>🎧 Voice</div>
                            {audioSrc ? (
                              <audio controls preload="none" src={audioSrc} style={{ height: 28, width: 180 }} />
                            ) : (
                              <div style={{ color: "#94a3b8" }}>No audio</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>

            <div style={{ ...styles.addTaskSection, ...panelTint }}>
              <h3 style={{ margin: "0 0 8px", fontSize: scaled(16) }}>📌 Add upcoming task</h3>

              <div style={styles.addTaskRowTop}>
                <select
                  value={newTaskType}
                  onChange={(e) => setNewTaskType(e.target.value)}
                  style={{ ...styles.taskTypeSelect, fontSize: scaled(12) }}
                >
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
                  style={{ ...styles.addTaskTextInput, fontSize: scaled(16) }}
                  placeholder="e.g. Call Grant about new car"
                />
              </div>

              <div style={styles.addTaskRowBottom}>
                <div style={styles.calendarPicker}>
                  <button
                    type="button"
                    onClick={() => setIsCalendarOpen((prev) => !prev)}
                    style={{ ...styles.calendarTrigger, fontSize: scaled(16) }}
                  >
                    {newTaskDate ? new Date(newTaskDate).toLocaleDateString("en-AU") : "Select date"}
                  </button>

                  {isCalendarOpen && (
                    <div style={styles.calendarPopover}>
                      <div style={styles.calendarHeader}>
                        <button type="button" onClick={() => goMonth(-1)} style={styles.calendarNavBtn}>◀</button>
                        <span style={styles.calendarHeaderLabel}>{calendarLabel}</span>
                        <button type="button" onClick={() => goMonth(1)} style={styles.calendarNavBtn}>▶</button>
                      </div>

                      <div style={styles.calendarWeekdays}>
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <span key={d} style={styles.calendarWeekday}>{d}</span>
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
                              onClick={() => { setNewTaskDate(iso); setIsCalendarOpen(false); }}
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

                <input type="time" value={newTaskTime} onChange={(e) => setNewTaskTime(e.target.value)} style={{ ...styles.addTaskTimeInput, fontSize: scaled(16) }} />

                <button type="button" onClick={handleAddUpcomingTask} style={{ ...styles.addTaskBtn, fontSize: scaled(16) }}>
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
              style={{ ...styles.footerBtn, background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.45)" }}
              disabled={!lead?.id}
              title="Add to CRM"
            >
              Add to CRM
            </button>

            <button
              id="gr8-automation-toggle"
              type="button"
              onClick={() => setShowAutomation((p) => !p)}
              style={{ ...styles.footerBtn, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.45)" }}
              disabled={!lead?.id}
              title="Send this lead into an Automation Flow"
            >
              Send to Automation
            </button>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleCloseInternal} style={{ ...styles.backBtn2, fontSize: scaled(16) }} disabled={isRecording}>Close</button>
            <button onClick={handleSaveLeadNotes} style={{ ...styles.saveBtn, fontSize: scaled(16) }}>Save Notes</button>
          </div>
        </div>

        {showAutomation && (
          <div id="gr8-automation-popover" style={styles.automationPopover}>
            <div style={styles.automationPopoverHeader}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#e5e7eb" }}>Send to Automation</div>
              <button type="button" onClick={() => setShowAutomation(false)} style={styles.automationPopoverX} title="Close">×</button>
            </div>
            <div style={styles.automationPopoverBody}>
              <SendToAutomationPanel leadId={lead?.id} onSent={() => setShowAutomation(false)} />
            </div>
          </div>
        )}

        <div style={styles.resizeHandle} onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          modalResizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: modalSize.width, startHeight: modalSize.height };
          setIsResizing(true);
        }} title="Drag to resize" />
      </div>
    </div>
  );
}

/* ---------------- Styles ---------------- */
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
  callsPhoneText: { fontSize: 16, opacity: 0.85 },
  smallToggleBtn: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(2,6,23,0.6)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
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
    fontSize: 16,
    whiteSpace: "nowrap",
  },
  smsNavHelp: { fontSize: 16, color: "#94a3b8" },

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

  recordingsRefreshBtn: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 800,
  },
  recordingsEmpty: {
    color: "#94a3b8",
    fontSize: 14,
    padding: "6px 2px",
  },

  timelineContainer: {
    flex: 1,
    minHeight: 0,
  },

  entriesList: {
    overflowY: "auto",
    paddingRight: 6,
    paddingBottom: 6,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flex: 1,
    minHeight: 0,
  },

  timelineRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: "6px 8px",
    borderBottom: "1px solid rgba(148,163,184,0.06)",
  },

  notesTextarea: {
    width: "100%",
    borderRadius: "10px",
    border: "1px solid #4b5563",
    padding: "10px 12px",
    background: "#020617",
    color: "#fff",
    lineHeight: 1.5,
    resize: "none",
    overflow: "hidden",
    height: "92px",
    fontFamily:
      'Arial, "Helvetica Neue", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
    fontWeight: 600,
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

  calendarHeaderLabel: { fontSize: 16, fontWeight: 500 },

  calendarNavBtn: {
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.6)",
    padding: "2px 6px",
    background: "transparent",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: 16,
  },

  calendarWeekdays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 2,
    marginBottom: 2,
  },

  calendarWeekday: { fontSize: 16, textAlign: "center", opacity: 0.7 },

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
    fontSize: 16,
    cursor: "pointer",
  },

  calendarDaySelected: {
    background: "#22c55e",
    borderColor: "#22c55e",
    color: "#fff",
    fontWeight: 600,
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

  tasksTitle: { fontSize: 16, fontWeight: 600, opacity: 0.9 },
  tasksLoading: { fontSize: 16, opacity: 0.7 },

  taskList: {
    marginTop: 4,
    maxHeight: 240,
    overflowY: "auto",
    paddingRight: 4,
  },

  taskEmptyText: { fontSize: 16, opacity: 0.7, margin: 0 },

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
  taskItemTitle: { fontSize: 16 },
  taskItemMeta: { display: "flex", flexWrap: "wrap", gap: 6 },

  taskMetaChip: {
    fontSize: 16,
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
    fontSize: 16,
    fontWeight: 600,
  },

  saveBtn: {
    background: "#3b82f6",
    border: "none",
    borderRadius: "10px",
    padding: "8px 14px",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 16,
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