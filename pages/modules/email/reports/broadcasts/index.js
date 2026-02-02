// pages/modules/email/reports/broadcasts/index.js
// Broadcast report — reads from email_sends only, no demo/test logic.

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../../utils/supabase-client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import ReportBanner from "../../../../../components/ui/ReportBanner";

const RANGE_TO_DAYS = { today: 0, d7: 7, d30: 30, d90: 90, all: null };
const PIE_COLORS = ["#22c55e", "#3b82f6", "#facc15", "#ef4444", "#a855f7", "#94a3b8"];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function isoDaysAgo(days) {
  if (days === null) return null;
  const d = startOfToday();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function normalizeStatus(r) {
  const st = String(r.status || "").toLowerCase();
  const le = String(r.last_event || "").toLowerCase();
  if (["delivered", "opened", "clicked", "sent", "bounced"].includes(st)) return st;
  if (le === "delivered") return "delivered";
  if (le === "open") return "opened";
  if (le === "click") return "clicked";
  if (le === "bounce" || le === "dropped") return "bounced";
  return st || "sent";
}

function BroadcastsReport() {
  const [range, setRange] = useState("today");
  const [chartMode, setChartMode] = useState("line");
  const [rows, setRows] = useState([]);
  const [nameMap, setNameMap] = useState({});
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const fromIso = useMemo(() => isoDaysAgo(RANGE_TO_DAYS[range]), [range]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        if (!mounted) return;
        setUserId(uid);
        if (!uid) {
          setRows([]);
          setNameMap({});
          setLoading(false);
          return;
        }
        let q = supabase
          .from("email_sends")
          .select(
            "id, email, recipient_email, status, last_event, open_count, click_count, unsubscribed, bounced_at, created_at, last_event_at, broadcast_id, sg_message_id"
          )
          .eq("user_id", uid)
          .not("broadcast_id", "is", null)
          .order("created_at", { ascending: true })
          .limit(10000);
        if (fromIso) q = q.gte("created_at", fromIso);
        const { data, error } = await q;
        if (error) throw error;
        const cleaned = (data || []).map((r) => {
          const email = r.email || r.recipient_email || r.recipient || null;
          return {
            ...r,
            email,
            status: normalizeStatus(r),
          };
        });
        if (!mounted) return;
        setRows(cleaned);
        const ids = Array.from(new Set(cleaned.map((r) => r.broadcast_id).filter(Boolean))).slice(0, 500);
        if (ids.length) {
          const { data: bcasts, error: bErr } = await supabase
            .from("email_broadcasts")
            .select("id, name, title, subject")
            .in("id", ids)
            .limit(500);
          if (!bErr && bcasts) {
            const m = {};
            for (const b of bcasts) m[b.id] = b.name || b.title || b.subject || "Broadcast";
            if (mounted) setNameMap(m);
          } else {
            if (mounted) setNameMap({});
          }
        } else {
          setNameMap({});
        }
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setErr(String(e?.message || e));
        setLoading(false);
      }
    }
    run();
    return () => (mounted = false);
  }, [fromIso, range]);

  const metrics = useMemo(() => {
    const sent = rows.length;
    const delivered = rows.filter((r) => ["delivered", "opened", "clicked"].includes(String(r.status || "").toLowerCase())).length;
    const opened = rows.filter((r) => Number(r.open_count || 0) > 0).length;
    const clicked = rows.filter((r) => Number(r.click_count || 0) > 0).length;
    const bounced = rows.filter((r) => String(r.status || "").toLowerCase() === "bounced").length;
    const unsub = rows.filter((r) => !!r.unsubscribed || String(r.status || "").toLowerCase() === "unsubscribe").length;
    return { sent, delivered, opened, clicked, bounced, unsub };
  }, [rows]);

  // Build chart data
  function buildAxis(range, rows) {
    let start;
    if (range === "all") {
      start = rows.length
        ? new Date(rows.reduce((min, r) => {
            const t = new Date(r.created_at).getTime();
            return t < min ? t : min;
          }, Date.now()))
        : startOfToday();
    } else {
      start = new Date(isoDaysAgo(RANGE_TO_DAYS[range]));
    }
    start.setHours(0, 0, 0, 0);
    const end = startOfToday();
    const out = [];
    let cur = new Date(start);
    while (cur <= end) {
      out.push(ymd(cur));
      cur = addDays(cur, 1);
    }
    return out;
  }

  const chartData = useMemo(() => {
    const axis = buildAxis(range, rows);
    const map = {};
    axis.forEach((d) => {
      map[d] = { date: d, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsub: 0 };
    });
    rows.forEach((r) => {
      const d = ymd(r.created_at);
      if (!map[d]) return;
      map[d].sent++;
      if (["delivered", "opened", "clicked"].includes(String(r.status || "").toLowerCase())) map[d].delivered++;
      if (Number(r.open_count || 0) > 0) map[d].opened++;
      if (Number(r.click_count || 0) > 0) map[d].clicked++;
      if (String(r.status || "").toLowerCase() === "bounced") map[d].bounced++;
      if (r.unsubscribed || String(r.status || "").toLowerCase() === "unsubscribe") map[d].unsub++;
    });
    return axis.map((d) => map[d]);
  }, [rows, range]);

  const pieData = useMemo(
    () =>
      [
        { name: "Delivered", value: metrics.delivered },
        { name: "Opened", value: metrics.opened },
        { name: "Clicked", value: metrics.clicked },
        { name: "Bounced", value: metrics.bounced },
        { name: "Unsubscribed", value: metrics.unsub },
      ].filter((x) => x.value > 0),
    [metrics]
  );

  const recent = useMemo(
    () =>
      [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 250),
    [rows]
  );

  return (
    <>
      <Head><title>Broadcast analytics</title></Head>
      <div style={styles.page}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{ width: 1320, maxWidth: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f59e0b', borderRadius: 18, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>📢</div>
              <div>
                <div style={{ fontSize: 48, fontWeight: 500, color: '#ffffff', margin: 0 }}>Broadcasts</div>
                <div style={{ fontSize: 18, color: '#ffffff', opacity: 1, margin: '4px 0 0 0' }}>Delivery, opens, clicks & unsubscribes</div>
              </div>
            </div>
            <Link href="/modules/email/reports" style={{ background: '#000000', color: '#ffffff', padding: '10px 16px', borderRadius: 999, textDecoration: 'none', fontWeight: 500, border: 'none', fontSize: 18 }}>← Back</Link>
          </div>
        </div>
        <div style={styles.container}>
          <div style={styles.rangeRow}>
            <RangePill label="Today" active={range === "today"} onClick={() => setRange("today")} />
            <RangePill label="Last 7 days" active={range === "d7"} onClick={() => setRange("d7")} />
            <RangePill label="Last 30 days" active={range === "d30"} onClick={() => setRange("d30")} />
            <RangePill label="Last 90 days" active={range === "d90"} onClick={() => setRange("d90")} />
            <RangePill label="All time" active={range === "all"} onClick={() => setRange("all")} />
            <div style={{ flex: 1 }} />
            <button style={styles.toggleBtn} onClick={() => setChartMode(chartMode === "line" ? "pie" : "line")}>{chartMode === "line" ? "View pie chart" : "View line graph"}</button>
          </div>
          {loading && <div style={styles.note}>Loading…</div>}
          {err && <div style={{ ...styles.note, border: "1px solid #ef4444" }}>{err}</div>}
          {!loading && !err && (
            <>
              <div style={styles.metricsGrid}>
                <Metric title="Sent" value={metrics.sent} />
                <Metric title="Delivered" value={metrics.delivered} />
                <Metric title="Opened" value={metrics.opened} />
                <Metric title="Clicked" value={metrics.clicked} />
                <Metric title="Bounced" value={metrics.bounced} />
                <Metric title="Unsubscribed" value={metrics.unsub} />
              </div>
              <div style={styles.chartWrap}>
                {chartMode === "line" ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={chartData}>
                      <XAxis dataKey="date" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line dataKey="sent" stroke="#94a3b8" dot={false} />
                      <Line dataKey="delivered" stroke="#22c55e" dot={false} />
                      <Line dataKey="opened" stroke="#3b82f6" dot={false} />
                      <Line dataKey="clicked" stroke="#facc15" dot={false} />
                      <Line dataKey="bounced" stroke="#ef4444" dot={false} />
                      <Line dataKey="unsub" stroke="#a855f7" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Tooltip />
                      <Legend />
                      <Pie data={pieData} dataKey="value" outerRadius={120}>
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={styles.tableWrap}>
                <div style={styles.tableHeadRow}>
                  <div style={styles.th}>When</div>
                  <div style={styles.th}>Email</div>
                  <div style={styles.th}>Broadcast</div>
                  <div style={styles.th}>Delivered</div>
                  <div style={styles.th}>Open</div>
                  <div style={styles.th}>Click</div>
                  <div style={styles.th}>Unsub</div>
                  <div style={styles.th}>Status</div>
                </div>
                {recent.length === 0 ? (
                  <div style={styles.tableEmpty}>No broadcast rows found for this period.</div>
                ) : (
                  recent.map((r) => {
                    const when = r.last_event_at || r.created_at;
                    const deliveredYes = ["delivered", "opened", "clicked"].includes(String(r.status || "").toLowerCase());
                    const bName = nameMap[r.broadcast_id] || "Broadcast";
                    return (
                      <div key={r.id} style={styles.tr}>
                        <div style={styles.td}>{when ? new Date(when).toLocaleString() : "—"}</div>
                        <div style={styles.td}>{r.email || "—"}</div>
                        <div style={styles.td} title={bName}>{bName}</div>
                        <div style={styles.td}>{deliveredYes ? "✓" : "—"}</div>
                        <div style={styles.td}>{Number(r.open_count || 0) > 0 ? "✓" : "—"}</div>
                        <div style={styles.td}>{Number(r.click_count || 0) > 0 ? "✓" : "—"}</div>
                        <div style={styles.td}>{r.unsubscribed || String(r.status || "").toLowerCase() === "unsubscribe" ? "Yes" : "—"}</div>
                        <div style={styles.td}>{String(r.status || "—")}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function RangePill({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ ...styles.rangePill, ...(active ? styles.rangePillActive : null) }}>
      {label}
    </button>
  );
}

function Metric({ title, value }) {
  return (
    <div style={styles.metricBox}>
      <div style={styles.metricTitle}>{title}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(15,23,42,0.9) 0%, rgba(2,6,23,1) 55%, rgba(2,6,23,1) 100%)",
    padding: "30px 20px 40px",
    color: "#e6eef8",
    fontSize: 16,
  },
  container: { maxWidth: 1320, margin: "0 auto" },

  banner: {
    width: "100%",
    borderRadius: 18,
    padding: "16px 18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  bannerTitle: { fontSize: 48, fontWeight: 600, color: "#ffffff", lineHeight: 1.05 },
  bannerSub: { fontSize: 18, marginTop: 3, color: "ffffff" },

  backBtn: {
    background: "rgba(0, 0, 0, 0.75)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "10px 16px",
    fontSize: 18,
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.18)",
    fontWeight: 600,
  },

  rangeRow: { marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rangePill: {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(2,6,23,0.55)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 16,
    cursor: "pointer",
    fontWeight: 600,
  },
  rangePillActive: { background: "rgba(250,204,21,0.20)", border: "1px solid rgba(250,204,21,0.55)" },

  toggleBtn: {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(2,6,23,0.75)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "10px 16px",
    fontSize: 16,
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  toggleBtnOn: {
    background: "rgba(34,197,94,0.18)",
    border: "1px solid rgba(34,197,94,0.55)",
  },

  note: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(2,6,23,0.55)",
    border: "1px solid rgba(255,255,255,0.10)",
    fontSize: 16,
    opacity: 0.95,
  },

  metricsGrid: { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 },
  metricBox: { padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" },
  metricTitle: { fontSize: 16, opacity: 0.85, fontWeight: 700 },
  metricValue: { fontSize: 16, fontWeight: 700, marginTop: 6 },

  chartWrap: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    background: "rgba(2,6,23,0.55)",
    border: "1px solid rgba(255,255,255,0.10)",
  },

  tableWrap: { marginTop: 14, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" },
  tableHeadRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 2fr 2fr .8fr .6fr .6fr .6fr 1fr",
    padding: "10px 12px",
    background: "rgba(255,255,255,0.06)",
  },
  th: { fontSize: 16, fontWeight: 700, opacity: 0.9 },
  tr: {
    display: "grid",
    gridTemplateColumns: "1.4fr 2fr 2fr .8fr .6fr .6fr .6fr 1fr",
    padding: "10px 12px",
    background: "rgba(2,6,23,0.45)",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  td: { fontSize: 16, opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tableEmpty: { padding: 12, fontSize: 16, opacity: 0.85, background: "rgba(2,6,23,0.45)" }
}
export default BroadcastsReport;