// /pages/store/dashboard.js
// TASKS + PLATFORM DASHBOARD -imports tasks from tasks + crm_tasks
// with subscriber/lead avatars, coloured module cards matching the side nav.

import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";
import { BarChart3, LineChart } from "lucide-react";
import ICONS from "../../components/iconMap";
import SubscriberAvatar from "../../components/crm/SubscriberAvatar";
import LeadDetailsModal from "../../components/crm/LeadDetailsModal";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Same Communities icon as SideNav
const CommunitiesIcon = ({ size = 22, color = "#000" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="7" r="3.2" />
    <circle cx="17" cy="7" r="3.2" />
    <circle cx="12" cy="17" r="3.2" />
    <line x1="9" y1="8.6" x2="10.6" y2="14.4" />
    <line x1="15" y1="8.6" x2="13.4" y2="14.4" />
  </svg>
);



// Card colour + icon map (matches SideNav colours)
const MODULE_META = {
  "email-marketing": {
    color: "#ffd11bdc", // u10
    Icon: ICONS.email,
  },
  // separate cards for vendors and affiliate revenue
  "affiliate-vendors": {
    // match Vendor Performance Reports (orange/graph)
    color: "#f97316",
    Icon: LineChart,
  },
  "affiliate-revenue": {
    // match Affiliate Analytics banner (pink/bar chart)
    color: "#ec4899",
    Icon: BarChart3,
  },
  // physical + digital split
  "physical-products": {
    color: "#0ea5e9", // u13
    Icon: ICONS.products,
  },
  "digital-products": {
    color: "#4f46e5", // purple-ish, matches digital/tech feel
    Icon: ICONS.products,
  },
  // keep old products meta around in case LS still has it
  products: {
    color: "#0ea5e9",
    Icon: ICONS.products,
  },
  leads: {
    color: "#f43f5e", // u04
    Icon: ICONS.leads,
  },
  subscriptions: {
    color: "#ec4899", // u12
    Icon: ICONS.courses,
  },
  webinars: {
    color: "#ef4444", // u14
    Icon: ICONS.webinars,
  },
  social: {
    color: "#06b6d4", // u18
    Icon: ICONS.social,
  },
  subaccounts: {
    color: "#10b981", // u19
    Icon: ICONS.subaccounts,
  },
  community: {
    color: "#14b8a6", // u17
    Icon: CommunitiesIcon,
  },
};

// where each module card should send you
const MODULE_ROUTES = {
  "email-marketing": "/modules/email/reports",
  "affiliate-vendors":
    "/modules/affiliates/vendor/manage-products/performance-reports",
  "affiliate-revenue": "/modules/affiliates/affiliate-marketplace/analytics",
  "physical-products": "/modules/physical-products",
  "digital-products": "/modules/digital-products",
  leads: "/leads",
  subscriptions: "/modules/online-courses",
  webinars: "/modules/webinars",
  social: "/modules/social-media",
  subaccounts: "/modules/subaccounts",
  community: "/modules/communities",
};

const DEFAULT_MODULE_CARDS = [
  {
    id: "email-marketing",
    title: "Email Marketing",
    subtitle: "Broadcasts, campaigns, piplines, crm, automations, autoresponders",
    enabled: true,
  },
  {
    id: "affiliate-vendors",
    title: "Vendor's Sales Revenue",
    subtitle: "Vendor's products you sell using affiliates",
    enabled: true,
  },
  {
    id: "affiliate-revenue",
    title: "Affiliate Sales - Other People's Products",
    subtitle: "Revenue earned selling other people's products",
    enabled: true,
  },
  {
    id: "physical-products",
    title: "Physical Products",
    subtitle: "Inventory, orders & fulfilment",
    enabled: true,
  },
  {
    id: "digital-products",
    title: "Digital Products",
    subtitle: "Files, access and delivery",
    enabled: true,
  },
  {
    id: "leads",
    title: "Leads & Contacts",
    subtitle: "New leads today, this week, this month",
    enabled: true,
  },
  {
    id: "subscriptions",
    title: "Subscriptions & Online Courses",
    subtitle: "New subscribers and course enrolments",
    enabled: true,
  },
  {
    id: "webinars",
    title: "Webinars & Live Events",
    subtitle: "Sessions held or booked",
    enabled: true,
  },
  {
    id: "social",
    title: "Social Media",
    subtitle: "Posts pushed out across channels",
    enabled: true,
  },
  {
    id: "subaccounts",
    title: "Agency / Sub-Accounts",
    subtitle: "Revenue from client sub-accounts",
    enabled: true,
  },
  {
    id: "community",
    title: "Community",
    subtitle: "New messages & total members",
    enabled: true,
  },
];

// same labels as CRM "Quick Actions"
const TASK_FILTERS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
  { key: "dueToday", label: "Due today" },
];

// localStorage keys
const DASHBOARD_CARD_STYLE_KEY = "gr8_dashboard_card_style";
const MODULE_CARDS_LS_KEY = "gr8_dashboard_module_cards_v2";
const MODULE_CARDS_LS_FALLBACK_KEY = "gr8_dashboard_module_cards";

// choose which timestamp to use for a task date
// supports:
//  - tasks:  due_at | created_at
//  - crm_tasks: due_date + task_time | created_at
function getTaskDate(task) {
  if (!task) return null;

  if (task.due_at) return task.due_at;

  if (task.due_date) {
    // crm_tasks style
    const dateStr = task.due_date; // 'YYYY-MM-DD'
    const timeStr = task.task_time || "00:00:00";
    return `${dateStr}T${timeStr}`;
  }

  return task.created_at || null;
}

// centralised "is this task still open?"
function isOpenTask(task) {
  if (!task) return false;
  // tasks table style (status string)
  if (typeof task.status === "string") {
    const s = task.status.toLowerCase();
    return !(s === "done" || s === "completed");
  }
  // crm_tasks style (completed boolean)
  if (typeof task.completed === "boolean") {
    return !task.completed;
  }
  // default
  return true;
}

// mark completed for status pill logic
function isTaskCompleted(task) {
  if (!task) return false;
  if (typeof task.completed === "boolean") return !!task.completed;
  if (typeof task.status === "string") {
    const s = task.status.toLowerCase();
    return s === "done" || s === "completed";
  }
  return false;
}

// filter tasks for a given yyyy-mm-dd (used mainly for stats)
function filterTasksForDate(tasksArray, dateStr) {
  if (!tasksArray || tasksArray.length === 0) return [];
  const base = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);

  return tasksArray.filter((t) => {
    const ts = getTaskDate(t);
    if (!ts) return false;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return false;
    return d >= start && d <= end;
  });
}

function getToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(15,23,42,${alpha})`;
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(h, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ===============================
// CALLS / VOICEMAIL SUMMARY HELPERS
// ===============================

const CALLS_LS_KEY = "gr8:crm:readCalls:v1";

function getCallsReadSet() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CALLS_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// same logic as crm/calls.js, but only used to detect recordings
function getRecordingSrcForDashboard(call) {
  if (!call) return null;
  const sidFromField = call.recording_sid;
  let sidFromUrl = null;

  if (!sidFromField && call.recording_url) {
    const m = String(call.recording_url).match(/Recordings\/(RE[\w\d]+)/i);
    if (m && m[1]) sidFromUrl = m[1];
  }

  const sid = sidFromField || sidFromUrl;
  if (!sid) return null;

  return `/api/twilio/recording?sid=${encodeURIComponent(sid)}`;
}

// apply CRM-style quick filters to the full combined task list
function applyTaskFilter(allTasks, view, dateStr) {
  if (!Array.isArray(allTasks) || allTasks.length === 0) return [];
  const selectedDate = dateStr || getToday();

  let filtered = allTasks;

  const todayStart = new Date(selectedDate);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(selectedDate);
  todayEnd.setHours(23, 59, 59, 999);

  if (view === "today") {
    filtered = filterTasksForDate(allTasks, selectedDate);
  } else if (view === "dueToday") {
    filtered = filterTasksForDate(allTasks, selectedDate).filter((t) =>
      isOpenTask(t)
    );
  } else if (view === "upcoming") {
    filtered = allTasks.filter((t) => {
      const ts = getTaskDate(t);
      if (!ts) return false;
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return false;
      return d > todayEnd && isOpenTask(t);
    });
  } else if (view === "overdue") {
    filtered = allTasks.filter((t) => {
      const ts = getTaskDate(t);
      if (!ts) return false;
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return false;
      return d < todayStart && isOpenTask(t);
    });
  } else if (view === "completed") {
    filtered = allTasks.filter((t) => !isOpenTask(t));
  } else {
    // "all"
    filtered = allTasks;
  }

  // always sort by datetime ascending so feed is sensible
  return [...filtered].sort((a, b) => {
    const da = new Date(getTaskDate(a) || 0).getTime();
    const db = new Date(getTaskDate(b) || 0).getTime();
    return da - db;
  });
}

// simple notes parser adapted from CRM/tasks
function parseNotes(raw) {
  if (!raw) {
    return {
      type: "Task",
      time: "",
      location: "",
      body: "",
    };
  }

  raw = String(raw);
  if (!raw.startsWith("[")) {
    return {
      type: "Task",
      time: "",
      location: "",
      body: raw,
    };
  }

  const closeIdx = raw.indexOf("]");
  if (closeIdx === -1) {
    return {
      type: "Task",
      time: "",
      location: "",
      body: raw,
    };
  }

  const meta = raw.slice(1, closeIdx);
  const body = raw.slice(closeIdx + 1).trim();

  const result = {
    type: "Task",
    time: "",
    location: "",
    body,
  };

  meta.split("•").forEach((chunk) => {
    const [labelRaw, valueRaw] = chunk.split(":");
    if (!labelRaw || !valueRaw) return;
    const label = labelRaw.trim().toLowerCase();
    const value = valueRaw.trim();
    if (label === "type") result.type = value || result.type;
    if (label === "time") result.time = value || "";
    if (label === "location") result.location = value || "";
  });

  return result;
}

export default function StoreDashboard() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRevenueCents: 0,
    totalOrders: 0,
    abandonedCount: 0,
    openTasksToday: 0,
    tasksToday: 0,
    totalTasks: 0,
    overdueTasks: 0,
    completedTasks: 0,
    subscribersTotal: 0,
    subscribersLast7: 0,
  });

  // NEW: email stats (last 7 days)
  const [emailStats, setEmailStats] = useState({
    broadcasts7d: 0,
    campaigns7d: 0,
    automations7d: 0,
    autoresponders7d: 0,
    total7d: 0,
  });

  // NEW: calls summary + voicemail pill state
  const [callsSummary, setCallsSummary] = useState({
    total: 0,
    unread: 0,
    withRecording: 0,
    unreadWithRecording: 0,
  });
  const [hasUnheard, setHasUnheard] = useState(false);

  const [orders, setOrders] = useState([]);
  const [checkouts, setCheckouts] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [subscriberMap, setSubscriberMap] = useState({});

  const [taskDate, setTaskDate] = useState(getToday());
  const [taskView, setTaskView] = useState("overdue"); // default: show overdue
  const [error, setError] = useState("");

  // ðŸ†• moduleCards: initialise directly from localStorage (so hidden modules stick)
  const [moduleCards, setModuleCards] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_MODULE_CARDS;
    }
    try {
      let raw = window.localStorage.getItem(MODULE_CARDS_LS_KEY);
      if (!raw) {
        raw = window.localStorage.getItem(MODULE_CARDS_LS_FALLBACK_KEY);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Failed to load module cards from localStorage:", e);
    }
    return DEFAULT_MODULE_CARDS;
  });

  const [showModuleConfig, setShowModuleConfig] = useState(false);

  // ðŸ”‘ Card style -default glass, then read LS on first client render
  const [cardStyle, setCardStyle] = useState("glass");

  // client edit modal
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [stages] = useState([]); // we're not using pipeline stages here, keep empty
  const [userId, setUserId] = useState(null);

  // selected tasks (checkbox) -dashboard version
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);

  const handleOpenLeadDetails = (lead) => {
    if (!lead) return;
    setSelectedLead(lead);
    setIsLeadModalOpen(true);
  };

  const handleOpenModuleRoute = (id) => {
    const route = MODULE_ROUTES[id];
    if (route) {
      router.push(route);
    }
  };

  // helper to persist card style
  const persistCardStyle = (style) => {
    setCardStyle(style);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DASHBOARD_CARD_STYLE_KEY, style);
    }
  };

  // ✅ Read saved card style from localStorage (glass / solid)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DASHBOARD_CARD_STYLE_KEY);
      if (raw === "glass" || raw === "solid") {
        setCardStyle(raw);
      }
    } catch {
      // ignore
    }
  }, []);

  // save layout whenever moduleCards changes (enabled/disabled or order)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        MODULE_CARDS_LS_KEY,
        JSON.stringify(moduleCards)
      );
    } catch (e) {
      console.warn("Failed to save module cards layout:", e);
    }
  }, [moduleCards]);

  // MAIN LOAD -stats + tasks + subscribers + email stats
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");

        const { data: sess } = await supabase.auth.getSession();
        const user = sess?.session?.user;
        if (!user) {
          setError("You must be logged in to view this page.");
          setLoading(false);
          return;
        }
        const currentUserId = user.id;
        setUserId(currentUserId);

        // orders and checkouts
        const [
          { data: ordersData, error: ordersErr },
          { data: sessionsData, error: sessionsErr },
        ] = await Promise.all([
          supabase
            .from("orders")
            .select("*")
            .eq("user_id", currentUserId)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("checkout_sessions")
            .select("*")
            .eq("user_id", currentUserId)
            .in("status", ["open", "abandoned"])
            .order("updated_at", { ascending: false })
            .limit(50),
        ]);

        if (ordersErr) {
          console.error(ordersErr);
          setError("Error loading orders.");
        }
        if (sessionsErr) {
          console.error(sessionsErr);
          setError("Error loading checkout sessions.");
        }

        const safeOrders = ordersData || [];
        const safeSessions = sessionsData || [];

        setOrders(safeOrders);
        setCheckouts(safeSessions);

        // tasks from main tasks table
        const {
          data: tasksData,
          error: tasksErr,
        } = await supabase
          .from("tasks")
          .select("*")
          .eq("owner", currentUserId);

        if (tasksErr) {
          console.error(tasksErr);
        }

        let combinedTasks = tasksData || [];

        // ALSO import subscriber tasks from crm_tasks table
        try {
          const {
            data: crmTasksData,
            error: crmErr,
          } = await supabase
            .from("crm_tasks")
            .select("*")
            .eq("user_id", currentUserId);

          if (!crmErr && Array.isArray(crmTasksData) && crmTasksData.length) {
            combinedTasks = [...combinedTasks, ...crmTasksData];
          } else if (crmErr) {
            console.warn(
              "crm_tasks query error (safe to ignore if not used):",
              crmErr
            );
          }
        } catch (e) {
          console.warn("crm_tasks lookup failed (table may not exist):", e);
        }

        // sort tasks by date/time
        combinedTasks.sort((a, b) => {
          const da = new Date(getTaskDate(a) || 0).getTime();
          const db = new Date(getTaskDate(b) || 0).getTime();
          return da - db;
        });

        setAllTasks(combinedTasks);

        // Subscriber stats (for mini cards -total + last 7 days)
        let subscribersTotal = 0;
        let subscribersLast7 = 0;
        try {
          const {
            data: subsForStats,
            error: subsStatsErr,
          } = await supabase
            .from("subscribers")
            .select("id, created_at")
            .eq("user_id", currentUserId);

          if (!subsStatsErr && Array.isArray(subsForStats)) {
            subscribersTotal = subsForStats.length;
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            subscribersLast7 = subsForStats.filter((s) => {
              const d = new Date(s.created_at);
              return !Number.isNaN(d.getTime()) && d >= sevenDaysAgo;
            }).length;
          } else if (subsStatsErr) {
            console.error("subscriber stats error:", subsStatsErr);
          }
        } catch (e) {
          console.error("subscriber stats lookup failed:", e);
        }

        // build subscriber/lead map from any contact_ids on those tasks
        const contactIds = Array.from(
          new Set(
            combinedTasks
              .map((t) => t.contact_id)
              .filter((v) => v && typeof v === "string")
          )
        );

        if (contactIds.length > 0) {
          const [subsRes, leadsRes] = await Promise.all([
            supabase
              .from("subscribers")
              .select("*")
              .eq("user_id", currentUserId)
              .in("id", contactIds),
            supabase
              .from("leads")
              .select("*")
              .eq("user_id", currentUserId)
              .in("id", contactIds),
          ]);

          const map = {};
          if (!subsRes.error && Array.isArray(subsRes.data)) {
            for (const s of subsRes.data) map[s.id] = s;
          } else if (subsRes.error) {
            console.error("subscribers lookup error:", subsRes.error);
          }

          if (!leadsRes.error && Array.isArray(leadsRes.data)) {
            for (const l of leadsRes.data) map[l.id] = l;
          } else if (leadsRes.error) {
            console.error("leads lookup error:", leadsRes.error);
          }

          setSubscriberMap(map);
        } else {
          setSubscriberMap({});
        }

        // stats -revenue + orders
        const totalRevenueCents = safeOrders.reduce(
          (sum, o) => sum + (o.amount_cents || 0),
          0
        );
        const totalOrders = safeOrders.length;
        const abandonedCount = safeSessions.filter(
          (s) => s.status === "abandoned"
        ).length;

        // task stats to feed mini cards
        const todayStr = getToday();
        const todayTasksArr = filterTasksForDate(combinedTasks, todayStr);
        const openTasksToday = todayTasksArr.filter((t) =>
          isOpenTask(t)
        ).length;
        const tasksToday = todayTasksArr.length;
        const totalTasks = combinedTasks.length;

        const now = new Date();
        const overdueTasks = combinedTasks.filter((t) => {
          const ts = getTaskDate(t);
          if (!ts) return false;
          const d = new Date(ts);
          if (Number.isNaN(d.getTime())) return false;
          return d < now && isOpenTask(t);
        }).length;

        const completedTasks = combinedTasks.filter(
          (t) => !isOpenTask(t)
        ).length;

        setStats({
          totalRevenueCents,
          totalOrders,
          abandonedCount,
          openTasksToday,
          tasksToday,
          totalTasks,
          overdueTasks,
          completedTasks,
          subscribersTotal,
          subscribersLast7,
        });

        // EMAIL STATS (last 7 days)
        const sevenDaysAgoISO = new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000
        ).toISOString();

        let broadcasts7d = 0;
        let campaigns7d = 0;
        let automations7d = 0;
        let autoresponders7d = 0;

        try {
          const {
            data: broadcastsData,
            error: broadcastsErr,
          } = await supabase
            .from("email_broadcasts")
            .select("id, sent_at, status")
            .eq("user_id", currentUserId)
            .eq("status", "sent")
            .gte("sent_at", sevenDaysAgoISO);

          if (!broadcastsErr && Array.isArray(broadcastsData)) {
            broadcasts7d = broadcastsData.length;
          } else if (broadcastsErr) {
            console.warn("email_broadcasts stats error:", broadcastsErr.message);
          }
        } catch (e) {
          console.warn(
            "email_broadcasts table might not exist, skipping email stats:",
            e.message
          );
        }

        try {
          const {
            data: campaignsData,
            error: campaignsErr,
          } = await supabase
            .from("email_campaigns_emails")
            .select("id, sent_at")
            .eq("user_id", currentUserId)
            .gte("sent_at", sevenDaysAgoISO);

          if (!campaignsErr && Array.isArray(campaignsData)) {
            campaigns7d = campaignsData.length;
          } else if (campaignsErr) {
            console.warn(
              "email_campaigns_emails stats error:",
              campaignsErr.message
            );
          }
        } catch (e) {
          console.warn(
            "email_campaigns_emails table might not exist, skipping:",
            e.message
          );
        }

        try {
          const {
            data: autoData,
            error: autoErr,
          } = await supabase
            .from("email_automation_sends")
            .select("id, sent_at, kind")
            .eq("user_id", currentUserId)
            .gte("sent_at", sevenDaysAgoISO);

          if (!autoErr && Array.isArray(autoData)) {
            automations7d = autoData.filter(
              (row) =>
                (row.kind || "").toLowerCase() === "automation" ||
                (row.kind || "").toLowerCase() === "flow"
            ).length;

            autoresponders7d = autoData.filter(
              (row) => (row.kind || "").toLowerCase() === "autoresponder"
            ).length;
          } else if (autoErr) {
            console.warn(
              "email_automation_sends stats error:",
              autoErr.message
            );
          }
        } catch (e) {
          console.warn(
            "email_automation_sends table might not exist, skipping:",
            e.message
          );
        }

        setEmailStats({
          broadcasts7d,
          campaigns7d,
          automations7d,
          autoresponders7d,
          total7d:
            broadcasts7d + campaigns7d + automations7d + autoresponders7d,
        });

        // visible tasks list -default to "overdue"
        setTasks(applyTaskFilter(combinedTasks, "overdue", taskDate));
        setSelectedTaskIds([]);

        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("Unexpected error loading dashboard.");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LOAD CALLS SUMMARY (for top card + pill)
  useEffect(() => {
    async function loadCallsSummary() {
      try {
        const res = await fetch("/api/crm/calls?limit=200");
        const data = await res.json();

        if (!res.ok) {
          console.error("calls summary error:", data.error || res.statusText);
          setCallsSummary({
            total: 0,
            unread: 0,
            withRecording: 0,
            unreadWithRecording: 0,
          });
          setHasUnheard(false);
          return;
        }

        const calls = Array.isArray(data.calls) ? data.calls : [];
        const readSet = getCallsReadSet();

        let total = calls.length;
        let unread = 0;
        let withRecording = 0;
        let unreadWithRecording = 0;

        for (const c of calls) {
          const hasRec = !!getRecordingSrcForDashboard(c);
          const isUnread = !readSet.has(c.id);

          if (isUnread) unread++;
          if (hasRec) withRecording++;
          if (hasRec && isUnread) unreadWithRecording++;
        }

        setCallsSummary({
          total,
          unread,
          withRecording,
          unreadWithRecording,
        });
        setHasUnheard(unreadWithRecording > 0);
      } catch (err) {
        console.error("loadCallsSummary fatal:", err);
        setCallsSummary({
          total: 0,
          unread: 0,
          withRecording: 0,
          unreadWithRecording: 0,
        });
        setHasUnheard(false);
      }
    }

    loadCallsSummary();
  }, []);

  // when tasks, view or date changes, refresh visible tasks
  useEffect(() => {
    setTasks(applyTaskFilter(allTasks, taskView, taskDate));
    setSelectedTaskIds((prev) =>
      prev.filter((id) => allTasks.some((t) => t.id === id))
    );
  }, [allTasks, taskView, taskDate]);

  const formatCurrency = (cents, currency = "AUD") => {
    const value = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: currency || "AUD",
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency || ""}`;
    }
  };

  const formatDateTime = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  };

  const renderCartSummary = (cart_items) => {
    if (!cart_items) return "-";

    let itemsObj = cart_items;
    if (typeof cart_items === "string") {
      try {
        itemsObj = JSON.parse(cart_items);
      } catch {
        return "-";
      }
    }

    const items = itemsObj.items || [];
    if (!Array.isArray(items) || items.length === 0) return "-";

    if (items.length === 1) {
      const it = items[0];
      return `${it.name || "Item"} x${it.quantity || 1}`;
    }

    return `${items.length} items`;
  };

  // drag & drop for module cards
  const handleModuleDragStart = (e, id) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleModuleDrop = (e, targetId) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;

    setModuleCards((prev) => {
      const fromIndex = prev.findIndex((c) => c.id === sourceId);
      const toIndex = prev.findIndex((c) => c.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleModuleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const toggleModuleVisibility = (id) => {
    setModuleCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const toggleSelectTask = (taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  };

  const handleDeleteSelectedTasks = async () => {
    if (selectedTaskIds.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${selectedTaskIds.length} selected task(s)?`)
    ) {
      return;
    }

    try {
      // try delete from both crm_tasks and tasks (ids that don't exist will be ignored)
      const ids = selectedTaskIds;

      const { error: crmErr } = await supabase
        .from("crm_tasks")
        .delete()
        .in("id", ids);

      if (crmErr) {
        console.error("crm_tasks delete error:", crmErr);
      }

      const { error: coreErr } = await supabase
        .from("tasks")
        .delete()
        .in("id", ids);

      if (coreErr) {
        console.error("tasks delete error:", coreErr);
      }

      setAllTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
      setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
      setSelectedTaskIds([]);
    } catch (e) {
      console.error("deleteSelectedTasks fatal:", e);
    }
  };

  const handleToggleTaskStatus = async (task) => {
    if (!task) return;
    try {
      const updates = {};
      let table = null;

      if (typeof task.completed === "boolean") {
        table = "crm_tasks";
        updates.completed = !task.completed;
      } else if (typeof task.status === "string") {
        table = "tasks";
        const currentlyDone = isTaskCompleted(task);
        updates.status = currentlyDone ? "open" : "completed";
      } else {
        return;
      }

      const { error: updateErr } = await supabase
        .from(table)
        .update(updates)
        .eq("id", task.id);

      if (updateErr) {
        console.error("toggleTaskStatus error:", updateErr);
      }

      setAllTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, ...updates } : t))
      );
    } catch (e) {
      console.error("toggleTaskStatus fatal:", e);
    }
  };

  const enabledCards = moduleCards.filter((c) => c.enabled);
  const disabledCards = moduleCards.filter((c) => !c.enabled);

  const allTasksSelected =
    tasks.length > 0 && selectedTaskIds.length === tasks.length;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e5e7eb",
        fontSize: 18,
      }}
    >
      <Head>
        <title>Tasks & Platform Overview</title>
      </Head>

      <div style={{ maxWidth: 1320, margin: "0 auto", paddingBottom: 50 }}>
        {/* GREEN BANNER */}
        <div
          style={{
            marginTop: 24,
            marginBottom: 18,
            background: "#22c55e",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontWeight: 550,
            fontSize: 32,
            borderRadius: 12,
            boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: "999px",
                background: "rgba(0,0,0,0.18)",
                fontSize: 32,
              }}
            >
              📊
            </span>
            <div>
              <div>Today&apos;s Important Tasks</div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 400,
                  opacity: 0.92,
                }}
              >
                Central control for tasks, sales and activity across your whole
                platform.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Voicemails pill in banner */}
            <button
              type="button"
              onClick={() => router.push("/modules/email/crm/calls")}
              style={{
                borderRadius: 999,
                padding: "8px 18px",
                fontSize: 16,
                fontWeight: 700,
                border: hasUnheard
                  ? "2px solid #f97316"
                  : "2px solid rgba(15,23,42,0.9)",
                background: hasUnheard ? "#b91c1c" : "#0f172a",
                color: hasUnheard ? "#fff7ed" : "#e5e7eb",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: hasUnheard
                  ? "0 0 0 2px rgba(248,113,113,0.7), 0 0 24px rgba(248,113,113,0.9)"
                  : "0 6px 16px rgba(0,0,0,0.45)",
                animation: hasUnheard
                  ? "voicemailBlink 1.1s linear infinite"
                  : "none",
                marginRight: 6,
              }}
            >
              {hasUnheard
                ? `Voicemails waiting (${callsSummary.unreadWithRecording})`
                : "Voicemails"}
            </button>

            <button
              type="button"
              onClick={() => setShowModuleConfig((v) => !v)}
              style={{
                background: "#020617",
                color: "#e5e7eb",
                border: "1px solid rgba(15,23,42,0.85)",
                borderRadius: 999,
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 16,
                boxShadow: "0 6px 16px rgba(0,0,0,0.55)",
              }}
            >
              ⚙️ Customise dashboard
            </button>
            <Link
              href="/dashboard"
              style={{
                background: "#020617",
                color: "#e5e7eb",
                border: "1px solid rgba(15,23,42,0.75)",
                borderRadius: 999,
                padding: "8px 18px",
                cursor: "pointer",
                fontWeight: 600,
                textDecoration: "none",
                boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
                fontSize: 16,
              }}
            >
              ← Back
            </Link>
          </div>
        </div>

        {/* ERROR BAR */}
        {error && !loading && (
          <div
            style={{
              background: "#7f1d1d",
              color: "#fecaca",
              padding: "10px 14px",
              borderRadius: 8,
              marginBottom: 18,
              fontSize: 18,
              border: "1px solid rgba(248,113,113,0.7)",
            }}
          >
            {error}
          </div>
        )}

        {/* MAIN CARD */}
        <div
          style={{
            borderRadius: 18,
            border: "1px solid #22c55e",
            boxShadow: "0 22px 60px rgba(0,0,0,0.7)",
            background:
              "linear-gradient(135deg, #020617 0%, #020617 60%, #020617 100%)",
            padding: 22,
          }}
        >
          {/* MINI CRM SUMMARY CARDS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <MiniStatCard
              title="Subscribers"
              primary={`${stats.subscribersTotal}`}
              secondary={`Joined last 7 days: ${stats.subscribersLast7}`}
              accent="#38bdf8"
            />
            <MiniStatCard
              title="Tasks Today"
              primary={`${stats.tasksToday}`}
              secondary={`Overdue: ${stats.overdueTasks}`}
              accent="#fbbf24"
            />
            <MiniStatCard
              title="Completed Tasks"
              primary={`${stats.completedTasks}`}
              secondary={`Total tasks: ${stats.totalTasks}`}
              accent="#22c55e"
            />
            <MiniStatCard
              title="Email Activity (7 days)"
              primary={`${emailStats.total7d} emails sent`}
              secondary={`Broadcasts ${emailStats.broadcasts7d} Â· campaigns ${emailStats.campaigns7d} Â· Auto ${
                emailStats.automations7d + emailStats.autoresponders7d
              }`}
              accent="#a855f7"
            />
          </div>

          {/* CALLS & VOICEMAIL CARD */}
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(248,113,113,0.8)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,64,175,0.96))",
              padding: 16,
              marginBottom: 24,
              boxShadow: "0 18px 45px rgba(0,0,0,0.9)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: "999px",
                      background: "rgba(15,23,42,0.85)",
                      boxShadow:
                        "0 0 0 2px rgba(248,113,113,0.7),0 8px 18px rgba(0,0,0,0.7)",
                    }}
                  >
                     📞
                  </span>
                  Calls &amp; Voicemails
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: "#cbd5f5",
                    marginTop: 2,
                    fontWeight: 400,
                  }}
                >
                  Live summary pulled from your CRM call log (same data as the
                  Calls page).
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  onClick={() => router.push("/modules/email/crm/calls")}
                  style={{
                    borderRadius: 999,
                    padding: "8px 18px",
                    fontSize: 16,
                    fontWeight: 700,
                    border: hasUnheard
                      ? "2px solid #f97316"
                      : "2px solid rgba(148,163,184,0.7)",
                    background: hasUnheard ? "#b91c1c" : "#0f172a",
                    color: hasUnheard ? "#fff7ed" : "#e5e7eb",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: hasUnheard
                      ? "0 0 0 2px rgba(248,113,113,0.7), 0 0 24px rgba(248,113,113,0.9)"
                      : "0 8px 18px rgba(0,0,0,0.6)",
                    animation: hasUnheard
                      ? "voicemailBlink 1.1s linear infinite"
                      : "none",
                  }}
                >
                  {hasUnheard
                    ? `Voicemails waiting (${callsSummary.unreadWithRecording})`
                    : "View calls"}
                </button>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 18,
                marginTop: 4,
              }}
            >
              <div>
                <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 400 }}>
                  Total calls logged
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {callsSummary.total}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 400 }}>
                  Calls with recordings
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {callsSummary.withRecording}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 16, color: "#fecaca", fontWeight: 400 }}>
                  Unheard voicemails (recordings)
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: hasUnheard ? "#fca5a5" : "#e5e7eb",
                  }}
                >
                  {callsSummary.unreadWithRecording}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 16, color: "#e5e7eb", fontWeight: 400 }}>
                  Unread call records
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {callsSummary.unread}
                </div>
              </div>
            </div>
          </div>

          {/* TASKS / DIARY */}
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(56,189,248,0.9)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(8,47,73,0.98))",
              padding: 18,
              marginBottom: 24,
              boxShadow: "0 18px 45px rgba(0,0,0,0.8)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                  }}
                >
                  Today&apos;s Schedule & To-Dos
                </div>
                <div
                  style={{
                    fontSize: 18,
                    color: "#9ca3af",
                    marginTop: 4,
                    fontWeight: 400,
                  }}
                >
                  Tasks imported from your CRM (reads from both{" "}
                  <code>tasks</code> and <code>crm_tasks</code>) with subscriber
                  coloured icons.
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    color: "#e5e7eb",
                    whiteSpace: "nowrap",
                  }}
                >
                  Focus date:
                </div>
                <input
                  type="date"
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid #1f2937",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 18,
                    padding: "6px 10px",
                    outline: "none",
                    boxShadow: "0 0 0 1px rgba(15,23,42,0.9)",
                  }}
                />
                <div
                  style={{
                    fontSize: 18,
                    color: "#e5e7eb",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open tasks today:{" "}
                  <span style={{ color: "#facc15", fontWeight: 700 }}>
                    {stats.openTasksToday}
                  </span>
                </div>
                {/* Add Task links to the CRM Tasks page */}
                <Link
                  href="/modules/email/crm/tasks"
                  style={{
                    borderRadius: 999,
                    border: "none",
                    background: "#22c55e",
                    color: "#f9fafb",
                    fontWeight: 700,
                    fontSize: 18,
                    padding: "8px 18px",
                    cursor: "pointer",
                    textDecoration: "none",
                    boxShadow: "0 10px 25px rgba(34,197,94,0.4)",
                    whiteSpace: "nowrap",
                  }}
                >
                  + Add Task
                </Link>
              </div>
            </div>

            {/* DELETE SELECTED + QUICK FILTERS (CRM-style row) */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                {/* Select all */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allTasksSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTaskIds(tasks.map((t) => t.id));
                      } else {
                        setSelectedTaskIds([]);
                      }
                    }}
                    style={{
                      width: 20,
                      height: 20,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 16,
                      color: "#e5e7eb",
                      fontWeight: 400,
                    }}
                  >
                    Select all
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleDeleteSelectedTasks}
                  disabled={selectedTaskIds.length === 0}
                  style={{
                    background:
                      selectedTaskIds.length === 0
                        ? "rgba(15,23,42,0.85)"
                        : "#ef4444",
                    border: "1px solid #ef4444",
                    borderRadius: 999,
                    padding: "6px 16px",
                    fontSize: 16,
                    fontWeight: 700,
                    color:
                      selectedTaskIds.length === 0 ? "#9ca3af" : "#fef2f2",
                    cursor:
                      selectedTaskIds.length === 0 ? "not-allowed" : "pointer",
                    boxShadow:
                      selectedTaskIds.length === 0
                        ? "none"
                        : "0 10px 22px rgba(239,68,68,0.45)",
                    whiteSpace: "nowrap",
                  }}
                >
                   🗑 Delete Selected ({selectedTaskIds.length})
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 16,
                    color: "#bbf7d0",
                    fontWeight: 600,
                    paddingRight: 4,
                  }}
                >
                  View:
                </span>
                {TASK_FILTERS.map((f) => {
                  const active = taskView === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setTaskView(f.key)}
                      style={{
                        borderRadius: 999,
                        border: active
                          ? "1px solid rgba(21,128,61,0.9)"
                          : "1px solid rgba(15,23,42,0.9)",
                        padding: "4px 12px",
                        fontSize: 16,
                        cursor: "pointer",
                        background: active
                          ? "linear-gradient(135deg,#22c55e,#16a34a)"
                          : "rgba(15,23,42,0.95)",
                        color: active ? "#f9fafb" : "#d1d5db",
                        boxShadow: active
                          ? "0 8px 16px rgba(34,197,94,0.45)"
                          : "none",
                        fontWeight: 500,
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TASKS LIST -CRM-style cards */}
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(31,41,55,0.9)",
                background: "#020617",
                padding: tasks.length === 0 ? 12 : 10,
                maxHeight: 680,
                overflowY: "auto",
                marginTop: 4,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {tasks.length === 0 ? (
                <div
                  style={{
                    fontSize: 18,
                    color: "#ecc619ff",
                  }}
                >
                  No tasks yet. Use <b>Add Task</b> to create or update tasks in
                  the CRM module.
                </div>
              ) : (
                tasks.map((t) => {
                  const sub =
                    t.contact_id && subscriberMap[t.contact_id]
                      ? subscriberMap[t.contact_id]
                      : null;

                  return (
                    <TaskRow
                      key={t.id}
                      task={t}
                      subscriber={sub}
                      selected={selectedTaskIds.includes(t.id)}
                      onToggleSelect={() => toggleSelectTask(t.id)}
                      onOpenLead={() =>
                        sub ? handleOpenLeadDetails(sub) : null
                      }
                      onToggleStatus={() => handleToggleTaskStatus(t)}
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* CORE STATS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 18,
              marginBottom: 24,
            }}
          >
            <StatCard
              label="Total Revenue"
              value={formatCurrency(stats.totalRevenueCents, "AUD")}
              accent="#22c55e"
            />
            <StatCard
              label="Total Orders"
              value={stats.totalOrders.toString()}
              accent="#38bdf8"
            />
            <StatCard
              label="Abandoned Carts"
              value={stats.abandonedCount.toString()}
              accent="#f97316"
            />
            <StatCard
              label="Open Tasks Today"
              value={stats.openTasksToday.toString()}
              accent="#eab308"
            />
          </div>

          {/* PLATFORM MODULE CARDS */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                }}
              >
                Platform Modules -Activity Overview
              </div>
              <div
                style={{
                  fontSize: 16,
                  color: "#ecc619ff",
                  fontWeight: 400,
                }}
              >
                Drag cards to reorder. Hide modules you&apos;re not using (you
                can add them back later).
              </div>
            </div>

            {showModuleConfig && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(148,163,184,0.5)",
                  background: "rgba(15,23,42,0.95)",
                  fontSize: 16,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  Visible modules
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  {enabledCards.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleModuleVisibility(c.id)}
                      style={{
                        borderRadius: 999,
                        border: "1px solid rgba(148,163,184,0.7)",
                        padding: "4px 10px",
                        background: "rgba(34,197,94,0.1)",
                        color: "#bbf7d0",
                        cursor: "pointer",
                        fontSize: 16,
                        fontWeight: 500,
                      }}
                    >
                      ✅ {c.title}
                    </button>
                  ))}
                  {enabledCards.length === 0 && (
                    <span style={{ color: "#f97316" }}>
                      No modules enabled -turn some back on below.
                    </span>
                  )}
                </div>

                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  Hidden modules
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  {disabledCards.length === 0 ? (
                    <span style={{ color: "#ecc619ff" }}>
                      Nothing hidden. Use the buttons above to hide modules you
                      don&apos;t use.
                    </span>
                  ) : (
                    disabledCards.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleModuleVisibility(c.id)}
                        style={{
                          borderRadius: 999,
                          border: "1px solid rgba(148,163,184,0.7)",
                          padding: "4px 10px",
                          background: "rgba(239,68,68,0.1)",
                          color: "#fecaca",
                          cursor: "pointer",
                          fontSize: 16,
                          fontWeight: 500,
                        }}
                      >
                         ➕ {c.title}
                      </button>
                    ))
                  )}
                </div>

                {/* CARD STYLE SWITCHER */}
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(31,41,55,0.9)",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Module card style
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => persistCardStyle("glass")}
                      style={{
                        borderRadius: 999,
                        padding: "6px 14px",
                        fontSize: 16,
                        border:
                          cardStyle === "glass"
                            ? "1px solid #22c55e"
                            : "1px solid rgba(148,163,184,0.7)",
                        background:
                          cardStyle === "glass"
                            ? "linear-gradient(135deg,rgba(34,197,94,0.2),rgba(34,197,94,0.05))"
                            : "rgba(15,23,42,0.9)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        boxShadow:
                          cardStyle === "glass"
                            ? "0 8px 18px rgba(34,197,94,0.45)"
                            : "none",
                      }}
                    >
                      Glass cards
                    </button>
                    <button
                      type="button"
                      onClick={() => persistCardStyle("solid")}
                      style={{
                        borderRadius: 999,
                        padding: "6px 14px",
                        fontSize: 16,
                        border:
                          cardStyle === "solid"
                            ? "1px solid #f97316"
                            : "1px solid #f97316",
                        background:
                          cardStyle === "solid"
                            ? "linear-gradient(135deg,#f97316,#f97316)"
                            : "rgba(15,23,42,0.9)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        boxShadow:
                          cardStyle === "solid"
                            ? "0 8px 18px rgba(22, 37, 249, 0.45)"
                            : "none",
                      }}
                    >
                      Solid colour cards
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 18,
              marginBottom: 24,
            }}
          >
            {enabledCards.map((card) => (
              <ModuleCard
                key={card.id}
                card={card}
                emailStats={emailStats}
                cardStyle={cardStyle}
                onDragStart={handleModuleDragStart}
                onDrop={handleModuleDrop}
                onDragOver={handleModuleDragOver}
                onHide={toggleModuleVisibility}
                onOpenModule={handleOpenModuleRoute}
              />
            ))}
          </div>

          {/* ORDERS + CHECKOUTS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 18,
            }}
          >
            <div
              style={{
                background:
                  "linear-gradient(180deg, #020617 0%, #020617 55%, #020617)",
                borderRadius: 14,
                border: "1px solid #38bdf8",
                padding: 14,
                minHeight: 220,
                boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
              }}
            >
              <SectionHeader
                title="Recent Orders"
                subtitle={`Last ${orders.length} orders`}
              />

              {orders.length === 0 ? (
                <EmptyCopy>No orders yet.</EmptyCopy>
              ) : (
                <ScrollTable>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 16,
                    }}
                  >
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Amount</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr
                          key={o.id}
                          style={{
                            borderTop: "1px solid rgba(31,41,55,0.9)",
                          }}
                        >
                          <Td>{formatDateTime(o.created_at)}</Td>
                          <Td>
                            {formatCurrency(
                              o.amount_cents || 0,
                              o.currency || "AUD"
                            )}
                          </Td>
                          <Td
                            style={{
                              textTransform: "capitalize",
                              color:
                                o.status === "paid" ? "#4ade80" : "#eab308",
                            }}
                          >
                            {o.status || "-"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              )}
            </div>

            <div
              style={{
                background:
                  "linear-gradient(180deg, #020617 0%, #020617 55%, #020617)",
                borderRadius: 14,
                border: "1px solid #f97316",
                padding: 14,
                minHeight: 220,
                boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
              }}
            >
              <SectionHeader
                title="Open & Abandoned Checkouts"
                subtitle={`Last ${checkouts.length} sessions`}
              />

              {checkouts.length === 0 ? (
                <EmptyCopy>
                  No open or abandoned checkouts yet. Once you start sending
                  traffic to a checkout, they will show up here.
                </EmptyCopy>
              ) : (
                <ScrollTable>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 16,
                    }}
                  >
                    <thead>
                      <tr>
                        <Th>Updated</Th>
                        <Th>Status</Th>
                        <Th>Cart</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkouts.map((s) => (
                        <tr
                          key={s.id}
                          style={{
                            borderTop: "1px solid rgba(31,41,55,0.9)",
                          }}
                        >
                          <Td>{formatDateTime(s.updated_at)}</Td>
                          <Td>
                            <span
                              style={{
                                padding: "4px 12px",
                                borderRadius: 999,
                                fontSize: 16,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                                background:
                                  s.status === "abandoned"
                                    ? "rgba(239,68,68,0.15)"
                                    : "rgba(234,179,8,0.15)",
                                border:
                                  s.status === "abandoned"
                                    ? "1px solid rgba(239,68,68,0.6)"
                                    : "1px solid rgba(234,179,8,0.6)",
                                color:
                                  s.status === "abandoned"
                                    ? "#fca5a5"
                                    : "#facc15",
                                fontWeight: 600,
                              }}
                            >
                              {s.status}
                            </span>
                          </Td>
                          <Td>{renderCartSummary(s.cart_items)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              )}
            </div>
          </div>

          {loading && (
            <div
              style={{
                marginTop: 18,
                fontSize: 18,
                color: "#9ca3af",
              }}
            >
              Loading dataâ€¦
            </div>
          )}
        </div>
      </div>

      {/* CLIENT EDIT MODAL */}
      <LeadDetailsModal
        isOpen={isLeadModalOpen}
        lead={selectedLead}
        stages={stages}
        userId={userId}
        fontScale={1.35}
        onClose={() => {
          setIsLeadModalOpen(false);
          setSelectedLead(null);
        }}
        onNotesUpdated={() => {
          // optional -keep this dashboard's tasks/leads in sync if needed
        }}
      />

      {/* keyframes for flashing voicemail pill */}
      <style jsx>{`
        @keyframes voicemailBlink {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          50% {
            transform: translateY(-1px);
            opacity: 0.4;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

/* TASK ROW -CRM-style for dashboard */

function TaskRow({
  task,
  subscriber,
  selected,
  onToggleSelect,
  onOpenLead,
  onToggleStatus,
}) {
  const parsed = parseNotes(task.notes || "");
  const taskDate = getTaskDate(task);

  const dueDateStr = task.due_date || (taskDate ? taskDate.slice(0, 10) : "");
  let dueLabel = "No date";
  if (dueDateStr) {
    const d = new Date(dueDateStr);
    if (!Number.isNaN(d.getTime())) {
      dueLabel = d.toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }

  const completed = isTaskCompleted(task);

  // status pill logic
  let statusLabel = "Scheduled";
  let statusColor = "#38bdf8";

  if (completed) {
    statusLabel = "Completed";
    statusColor = "#22c55e";
  } else if (dueDateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dueDateStr);
    d.setHours(0, 0, 0, 0);

    if (d < today) {
      statusLabel = "Overdue";
      statusColor = "#f97316";
    } else if (d.getTime() === today.getTime()) {
      statusLabel = "Due today";
      statusColor = "#eab308";
    }
  }

  const name =
    (subscriber &&
      (subscriber.name ||
        subscriber.full_name ||
        [subscriber.first_name, subscriber.last_name]
          .filter(Boolean)
          .join(" "))) ||
    "No subscriber";

  const email = subscriber && subscriber.email ? subscriber.email : "";

  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleLeadClick = () => {
    if (subscriber && onOpenLead) onOpenLead();
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        padding: "10px 12px",
        borderRadius: 14,
        background:
          "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(15,23,42,0.96))",
        border: "1px solid rgba(31,41,55,0.9)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          flex: 1,
        }}
      >
        {/* checkbox -replaces old 00:00 column */}
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          style={{
            width: 22,
            height: 22,
            marginTop: 6,
          }}
        />

        <div style={{ flex: 1 }}>
          {/* subscriber avatar + name */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
              cursor: subscriber ? "pointer" : "default",
            }}
            onClick={handleLeadClick}
          >
            {subscriber ? (
              <SubscriberAvatar lead={subscriber} size={30} fontSize={16} />
            ) : (
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "999px",
                  background: "#38bdf8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#020617",
                  boxShadow:
                    "0 0 0 2px rgba(15,23,42,0.9), 0 0 12px rgba(0,0,0,0.6)",
                }}
              >
                {initials}
              </div>
            )}
            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: completed ? "#9ca3af" : "#e5e7eb",
                }}
              >
                {name}
              </div>
              {email && (
                <div
                  style={{
                    fontSize: 16,
                    color: "#9ca3af",
                    fontWeight: 400,
                  }}
                >
                  {email}
                </div>
              )}
            </div>
          </div>

          {/* type pill */}
          <div style={{ marginBottom: 4 }}>
            <span
              style={{
                display: "inline-block",
                fontSize: 16,
                padding: "2px 10px",
                borderRadius: 999,
                background: "rgba(56,189,248,0.15)",
                border: "1px solid rgba(56,189,248,0.7)",
                fontWeight: 500,
              }}
            >
              {parsed.type || "Task"}
            </span>
          </div>

          {/* title */}
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              textDecoration: completed ? "line-through" : "none",
              opacity: completed ? 0.7 : 1,
            }}
          >
            {task.title || "Untitled task"}
          </div>

          {/* notes body */}
          {parsed.body && (
            <div
              style={{
                marginTop: 4,
                fontSize: 16,
                color: "#d1d5db",
                whiteSpace: "pre-wrap",
              }}
            >
              {parsed.body}
            </div>
          )}
        </div>
      </div>

      {/* right side -due + status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 16,
              color: "#9ca3af",
              fontWeight: 400,
            }}
          >
            Due
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {dueLabel}
          </div>
        </div>

        <span
          onClick={onToggleStatus}
          style={{
            fontSize: 16,
            fontWeight: 700,
            borderRadius: 999,
            padding: "4px 10px",
            color: "#020617",
            background: statusColor,
            cursor: "pointer",
          }}
          title="Click to toggle completed"
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

/* MODULE CARDS -supports glass + solid */

function ModuleCard({
  card,
  emailStats,
  cardStyle,
  onDragStart,
  onDrop,
  onDragOver,
  onHide,
  onOpenModule,
}) {
  const meta = MODULE_META[card.id] || {};
  const borderColor = meta.color || "#38bdf8";
  const Icon = meta.Icon || null;

  const placeholderToday = 0;
  const placeholderWeek = 0;
  const placeholderMonth = 0;

  const isEmail = card.id === "email-marketing";

  const handleClick = () => {
    if (onOpenModule) onOpenModule(card.id);
  };

  const broadcastCount = emailStats?.broadcasts7d || 0;
  const campaignsCount = emailStats?.campaigns7d || 0;
  const autoCount =
    (emailStats?.automations7d || 0) + (emailStats?.autoresponders7d || 0);
  const autoresCount = emailStats?.autoresponders7d || 0;

  const baseProps = {
    draggable: true,
    onDragStart: (e) => onDragStart(e, card.id),
    onDragOver,
    onDrop: (e) => onDrop(e, card.id),
    onClick: handleClick,
  };

  if (cardStyle === "solid") {
    // SOLID COLOUR VERSION
    return (
      <div
        {...baseProps}
        style={{
          borderRadius: 14,
          background: borderColor,
          padding: 18,
          boxShadow: "0 14px 36px rgba(0,0,0,0.85)",
          cursor: "pointer",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: "rgba(0,0,0,0.22)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
              }}
            >
              {Icon ? <Icon color="#ffffff" size={26} /> : "?"}
            </div>

            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{card.title}</div>
              <div style={{ fontSize: 16, opacity: 0.9, fontWeight: 400 }}>
                {card.subtitle}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onHide(card.id);
            }}
            style={{
              border: "none",
              background: "transparent",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: 22,
              fontWeight: 900,
              paddingLeft: 6,
            }}
          >
             ✖
          </button>
        </div>

        {isEmail ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
                marginTop: 6,
              }}
            >
              <SmallMetric label="Broadcasts sent (7d)" value={broadcastCount} />
              <SmallMetric
                label="campaigns emails (7d)"
                value={campaignsCount}
              />
              <SmallMetric label="Automation emails (7d)" value={autoCount} />
              <SmallMetric
                label="Autoresponder sends (7d)"
                value={autoresCount}
              />
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 16,
                opacity: 0.82,
                fontWeight: 400,
              }}
            >
              Live counts are pulled from your email send tables.
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 10,
              }}
            >
              <div>
                <div
                  style={{ fontSize: 16, opacity: 0.85, fontWeight: 400 }}
                >
                  Today
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {placeholderToday}
                </div>
              </div>

              <div>
                <div
                  style={{ fontSize: 16, opacity: 0.85, fontWeight: 400 }}
                >
                  This week
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {placeholderWeek}
                </div>
              </div>

              <div>
                <div
                  style={{ fontSize: 16, opacity: 0.85, fontWeight: 400 }}
                >
                  This month
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {placeholderMonth}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 8,
                fontSize: 16,
                opacity: 0.8,
                fontWeight: 400,
              }}
            >
              Placeholder stats -connected shortly to real data.
            </div>
          </>
        )}
      </div>
    );
  }

  // GLASS VERSION (current look)
  return (
    <div
      {...baseProps}
      style={{
        borderRadius: 14,
        border: `1px solid ${borderColor}`,
        background: `linear-gradient(135deg, rgba(4, 2, 29, 0.98), ${hexToRgba(
          borderColor,
          0.65
        )})`,
        padding: 14,
        boxShadow: "0 14px 36px rgba(0,0,0,0.75)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: "#020617",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: `0 0 0 2px ${borderColor}`,
            }}
          >
            {Icon ? <Icon color={borderColor} size={22} /> : "?"}
          </div>
          <div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
              }}
            >
              {card.title}
            </div>
            <div
              style={{
                fontSize: 16,
                color: "#9ca3af",
                fontWeight: 400,
              }}
            >
              {card.subtitle}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // don't trigger navigation when hiding
            onHide(card.id);
          }}
          style={{
            border: "none",
            background: "transparent",
            color: "#9ca3af",
            cursor: "pointer",
            fontSize: 18,
          }}
          title="Hide this module"
        >
           ✖
        </button>
      </div>

      {isEmail ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginTop: 6,
            }}
          >
            <SmallMetric label="Broadcasts sent (7d)" value={broadcastCount} />
            <SmallMetric label="campaigns emails (7d)" value={campaignsCount} />
            <SmallMetric label="Automation emails (7d)" value={autoCount} />
            <SmallMetric
              label="Autoresponder sends (7d)"
              value={autoresCount}
            />
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 16,
              color: "#6b7280",
              fontWeight: 400,
            }}
          >
            Live counts are pulled from your email send tables. If any numbers
            stay on zero, the table names/columns just need a quick tweak in
            the dashboard code.
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
            }}
          >
            <div>
              <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 400 }}>
                Today
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {placeholderToday}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 400 }}>
                This week
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {placeholderWeek}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 400 }}>
                This month
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {placeholderMonth}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 16,
              color: "#6b7280",
              fontWeight: 400,
            }}
          >
            Placeholder stats for now -will be wired to live data from this
            module (signups, revenue, posts, etc.).
          </div>
        </>
      )}
    </div>
  );
}

function SmallMetric({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 16, color: "#9ca3af", fontWeight: 400 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/* MINI SUMMARY CARDS (top row) */

function MiniStatCard({ title, primary, secondary, accent }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${accent}`,
        padding: "10px 14px",
        background:
          "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(15,23,42,0.96))",
        boxShadow: "0 10px 26px rgba(0,0,0,0.7)",
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 6,
          color: "#e5e7eb",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 2,
          color: accent,
        }}
      >
        {primary}
      </div>
      <div
        style={{
          fontSize: 16,
          color: "#9ca3af",
          fontWeight: 400,
        }}
      >
        {secondary}
      </div>
    </div>
  );
}

/* PRESENTATIONAL HELPERS */

function StatCard({ label, value, accent }) {
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(15,23,42,1))",
        borderRadius: 14,
        border: `1px solid ${accent}`,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "0 12px 30px rgba(0,0,0,0.7)",
      }}
    >
      <div
        style={{
          fontSize: 18,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "#9ca3af",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "#e5e7eb",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 16,
          color: "#6b7280",
          fontWeight: 400,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

function ScrollTable({ children }) {
  return (
    <div
      style={{
        maxHeight: 460,
        overflowY: "auto",
        borderRadius: 10,
        border: "1px solid rgba(31,41,55,0.8)",
      }}
    >
      {children}
    </div>
  );
}

function EmptyCopy({ children }) {
  return (
    <div
      style={{ fontSize: 16, color: "#6b7280", marginTop: 4, fontWeight: 400 }}
    >
      {children}
    </div>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontSize: 16,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "#9ca3af",
        borderBottom: "1px solid rgba(31,41,55,0.9)",
        position: "sticky",
        top: 0,
        background: "#020617",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }) {
  return (
    <td
      style={{
        padding: "7px 10px",
        fontSize: 16,
        color: "#e5e7eb",
        verticalAlign: "top",
        fontWeight: 400,
        ...style,
      }}
    >
      {children}
    </td>
  );
}
