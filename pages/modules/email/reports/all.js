// /pages/modules/email/reports/all.js
// FULL REPLACEMENT — FIXED
// ❌ REMOVED source_type (does NOT exist in your DB)
// ✅ Line graph + pie chart
// ✅ Graph ALWAYS spans selected range (7/30/90/all) with zero-fill
// ✅ Delivery column included
// ✅ No chatter

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../utils/supabase-client";
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

/* ---------------- constants ---------------- */

const RANGE_TO_DAYS = { today: 0, d7: 7, d30: 30, d90: 90, all: null };
const PIE_COLORS = ["#22c55e", "#3b82f6", "#facc15", "#ef4444", "#a855f7"];

/* ---------------- helpers ---------------- */

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

/* build FULL date axis even when no sends happened */
function buildAxis(range, rows) {
  let start;
  if (range === "all") {
    start = rows.length ? new Date(rows[0].created_at) : startOfToday();
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

function normalizeStatus(r) {
  const st = String(r.status || "").toLowerCase();
  const le = String(r.last_event || "").toLowerCase();
  if (["delivered", "opened", "clicked", "sent"].includes(st)) return st;
  if (le === "delivered") return "delivered";
  if (le === "open") return "opened";
  if (le === "click") return "clicked";
  if (le === "bounce" || le === "dropped") return "bounced";
  return st || "sent";
}

function guessType(r) {
  if (r.broadcast_id) return "Broadcast";
    if (r.campaign_id) return "Campaign";
  if (r.automation_id) return "Automation";
  if (r.autoresponder_id) return "Autoresponder";
  return "—";
}

/* ---------------- page ---------------- */

export default function AllEmailReport() {
  const [range, setRange] = useState("d7");
  const [chartMode, setChartMode] = useState("line");
  const [rows, setRows] = useState([]);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const fromIso = useMemo(() => isoDaysAgo(RANGE_TO_DAYS[range]), [range]);

  /* -------- fetch -------- */
  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) {
          setRows([]);
          setLoading(false);
          return;
        }
        setUserId(uid);

        let q = supabase
          .from("email_sends")
          .select(
            "id,email,status,last_event,open_count,click_count,unsubscribed,bounced_at,created_at,last_event_at,broadcast_id,campaign_id,automation_id,autoresponder_id"
          )
          .eq("user_id", uid)
          .order("created_at", { ascending: true })
          .limit(10000);

        if (fromIso) q = q.gte("created_at", fromIso);

        const { data, error } = await q;
        if (error) throw error;

        if (!mounted) return;
        setRows((data || []).map((r) => ({ ...r, status: normalizeStatus(r) })));
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setErr(String(e.message || e));
        setLoading(false);
      }
    }
    run();
    return () => (mounted = false);
  }, [fromIso]);

  /* -------- metrics -------- */
  const metrics = useMemo(() => {
    const sent = rows.length;
    const delivered = rows.filter((r) =>
      ["delivered", "opened", "clicked"].includes(r.status)
    ).length;
    const opened = rows.filter((r) => r.open_count > 0).length;
    const clicked = rows.filter((r) => r.click_count > 0).length;
    const bounced = rows.filter((r) => r.status === "bounced").length;
    const unsub = rows.filter((r) => r.unsubscribed).length;
    return { sent, delivered, opened, clicked, bounced, unsub };
  }, [rows]);

  /* -------- charts -------- */
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
      if (["delivered", "opened", "clicked"].includes(r.status)) map[d].delivered++;
      if (r.open_count > 0) map[d].opened++;
      if (r.click_count > 0) map[d].clicked++;
      if (r.status === "bounced") map[d].bounced++;
      if (r.unsubscribed) map[d].unsub++;
    });
    return axis.map((d) => map[d]);
  }, [rows, range]);

  const pieData = useMemo(
    () => [
      { name: "Delivered", value: metrics.delivered },
      { name: "Opened", value: metrics.opened },
      { name: "Clicked", value: metrics.clicked },
      { name: "Bounced", value: metrics.bounced },
      { name: "Unsubscribed", value: metrics.unsub },
    ].filter((x) => x.value > 0),
    [metrics]
  );

  const recent = useMemo(
    () => [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100),
    [rows]
  );

  /* -------- render -------- */
  return (
    <>
      <Head><title>All email analytics</title></Head>
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={{ ...styles.banner, background: "#10b981", display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ fontSize: 48, marginRight: 12 }}>📊</span>
            <div>
              <div style={styles.bannerTitle}>All email types (Total)</div>
              <div style={styles.bannerSub}>Live data from all locations</div>
            </div>
            <Link href="/modules/email/reports" style={{ ...styles.backBtn, background: "#fffbe8", color: "#241a00", borderRadius: 999, padding: "12px 22px", fontSize: 18, textDecoration: "none", border: "1px solid #10b981", fontWeight: 600, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", marginLeft: "auto" }}>← Back</Link>
          </div>

          <div style={styles.rangeRow}>
            <RangePill label="Today" active={range==="today"} onClick={()=>setRange("today")} />
            <RangePill label="Last 7 days" active={range==="d7"} onClick={()=>setRange("d7")} />
            <RangePill label="Last 30 days" active={range==="d30"} onClick={()=>setRange("d30")} />
            <RangePill label="Last 90 days" active={range==="d90"} onClick={()=>setRange("d90")} />
            <RangePill label="All time" active={range==="all"} onClick={()=>setRange("all")} />
            <div style={{flex:1}} />
            <button style={styles.toggleBtn} onClick={()=>setChartMode(chartMode==="line"?"pie":"line")}>
              {chartMode==="line" ? "View pie chart" : "View line graph"}
            </button>
          </div>

          {loading && <div style={styles.note}>Loading…</div>}
          {err && <div style={{...styles.note, border:"1px solid #ef4444"}}>{err}</div>}

          {!loading && !err && (
            <>
              <div style={styles.metricsGrid}>
                <Metric title="Sent" value={metrics.sent}/>
                <Metric title="Delivered" value={metrics.delivered}/>
                <Metric title="Opened" value={metrics.opened}/>
                <Metric title="Clicked" value={metrics.clicked}/>
                <Metric title="Bounced" value={metrics.bounced}/>
                <Metric title="Unsubscribed" value={metrics.unsub}/>
              </div>

              <div style={styles.chartWrap}>
                {chartMode==="line" ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={chartData}>
                      <XAxis dataKey="date"/>
                      <YAxis allowDecimals={false}/>
                      <Tooltip/>
                      <Legend/>
                      <Line dataKey="sent" stroke="#94a3b8" dot={false}/>
                      <Line dataKey="delivered" stroke="#22c55e" dot={false}/>
                      <Line dataKey="opened" stroke="#3b82f6" dot={false}/>
                      <Line dataKey="clicked" stroke="#facc15" dot={false}/>
                      <Line dataKey="bounced" stroke="#ef4444" dot={false}/>
                      <Line dataKey="unsub" stroke="#a855f7" dot={false}/>
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart>
                      <Tooltip/>
                      <Legend/>
                      <Pie data={pieData} dataKey="value" outerRadius={120}>
                        {pieData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div style={styles.tableWrap}>
                <div style={styles.tableHeadRow}>
                  <div style={styles.th}>When</div>
                  <div style={styles.th}>Email</div>
                  <div style={styles.th}>Type</div>
                  <div style={styles.th}>Delivered</div>
                  <div style={styles.th}>Open</div>
                  <div style={styles.th}>Click</div>
                  <div style={styles.th}>Unsub</div>
                  <div style={styles.th}>Status</div>
                </div>
                {recent.map(r=>(
                  <div key={r.id} style={styles.tr}>
                    <div style={styles.td}>{new Date(r.created_at).toLocaleString()}</div>
                    <div style={styles.td}>{r.email}</div>
                    <div style={styles.td}>{guessType(r)}</div>
                    <div style={styles.td}>{["delivered","opened","clicked"].includes(r.status)?"Yes":"—"}</div>
                    <div style={styles.td}>{r.open_count||0}</div>
                    <div style={styles.td}>{r.click_count||0}</div>
                    <div style={styles.td}>{r.unsubscribed?"Yes":"—"}</div>
                    <div style={styles.td}>{r.status}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------------- UI bits ---------------- */

function RangePill({label,active,onClick}) {
  return <button onClick={onClick} style={{...styles.rangePill,...(active?styles.rangePillActive:{})}}>{label}</button>;
}
function Metric({title,value}) {
  return <div style={styles.metricBox}><div style={styles.metricTitle}>{title}</div><div style={styles.metricValue}>{value}</div></div>;
}

/* ---------------- styles ---------------- */

const styles = {
  page:{minHeight:"100vh",background:"radial-gradient(circle at top,#0f172a 0%,#020617 55%)",padding:"30px 20px",color:"#e6eef8",fontSize:16},
  container:{maxWidth:1320,margin:"0 auto"},
  banner:{borderRadius:18,padding:"16px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"},

  bannerTitle:{fontSize:48,fontWeight:600,color:"#052b1b"},
  bannerSub:{fontSize:18},
  backBtn:{fontSize:16},
  rangeRow:{marginTop:12,display:"flex",gap:8,flexWrap:"wrap"},
  rangePill:{padding:"7px 12px",fontSize:16},
  rangePillActive:{background:"rgba(16,185,129,0.25)"},
  toggleBtn:{padding:"8px 14px",fontSize:16},
  note:{marginTop:10,padding:10},
  metricsGrid:{marginTop:14,display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10},
  metricBox:{padding:12},
  metricTitle:{fontSize:16},
  metricValue:{fontSize:16,fontWeight:700},
  chartWrap:{marginTop:14,padding:14},
  tableWrap:{marginTop:14},
  tableHeadRow:{display:"grid",gridTemplateColumns:"1.4fr 2fr 1fr .8fr .6fr .6fr .6fr 1fr"},
  th:{fontSize:16,fontWeight:700},
  tr:{display:"grid",gridTemplateColumns:"1.4fr 2fr 1fr .8fr .6fr .6fr .6fr 1fr"},
  td:{fontSize:16}
};
