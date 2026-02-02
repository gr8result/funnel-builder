// SAME AS BROADCASTS REPORT â€” FILTERS campaigns_id NOT NULL

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../../utils/supabase-client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";
import ReportBanner from "../../../../../components/ui/ReportBanner";

const RANGE_TO_DAYS = { today: 0, d7: 7, d30: 30, d90: 90, all: null };
const PIE_COLOURS = ["#22c55e","#3b82f6","#facc15","#ef4444","#94a3b8"];

function isoDaysAgo(days) {
  if (days === null) return null;
  const d = new Date();
  if (days === 0) d.setHours(0,0,0,0);
  else d.setDate(d.getDate() - days);
  return d.toISOString();
}

export default function campaignsReport() {
  const [rows, setRows] = useState([]);
  const [nameMap, setNameMap] = useState({});
  const [range, setRange] = useState("all");
  const [chartType, setChartType] = useState("line");

  const fromIso = useMemo(() => isoDaysAgo(RANGE_TO_DAYS[range]), [range]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) return setRows([]);

      let q = supabase
        .from("email_sends")
        .select("id,email,status,open_count,click_count,unsubscribed,created_at,campaign_id,last_event_at")
        .eq("user_id", userId)
        .not("campaign_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(5000);

      if (fromIso) q = q.gte("created_at", fromIso);

      const { data } = await q;
      if (mounted) setRows(data || []);

      // Fetch campaign names
      if (data && data.length > 0) {
        const ids = Array.from(new Set(data.map(r => r.campaign_id).filter(Boolean))).slice(0, 500);
        if (ids.length) {
          const { data: campaigns } = await supabase
            .from("email_campaigns")
            .select("id, name, title, subject")
            .in("id", ids)
            .limit(500);
          if (campaigns) {
            const m = {};
            for (const c of campaigns) m[c.id] = c.name || c.title || c.subject || "Campaign";
            if (mounted) setNameMap(m);
          }
        }
      }
    })();
    return () => (mounted = false);
  }, [fromIso]);

  const metrics = useMemo(() => {
    const sent = rows.length;
    const delivered = rows.filter(r => ["delivered","opened","clicked"].includes(r.status)).length;
    const opened = rows.filter(r => (r.open_count||0)>0).length;
    const clicked = rows.filter(r => (r.click_count||0)>0).length;
    const unsub = rows.filter(r => r.unsubscribed).length;
    return { sent, delivered, opened, clicked, unsub };
  }, [rows]);

  const chartData = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      const d = r.created_at.slice(0,10);
      if (!map[d]) map[d]={date:d,sent:0,delivered:0,opened:0,clicked:0,unsub:0};
      map[d].sent++;
      if (["delivered","opened","clicked"].includes(r.status)) map[d].delivered++;
      if ((r.open_count||0)>0) map[d].opened++;
      if ((r.click_count||0)>0) map[d].clicked++;
      if (r.unsubscribed) map[d].unsub++;
    });
    const keys = Object.keys(map).sort();
    if (keys.length===1) {
      const p=new Date(keys[0]); p.setDate(p.getDate()-1);
      map[p.toISOString().slice(0,10)]={date:p.toISOString().slice(0,10),sent:0,delivered:0,opened:0,clicked:0,unsub:0};
    }
    return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
  }, [rows]);

  const pieData = [
    { name:"Delivered", value:metrics.delivered },
    { name:"Opened", value:metrics.opened },
    { name:"Clicked", value:metrics.clicked },
    { name:"Unsubscribed", value:metrics.unsub },
    { name:"Other", value: metrics.sent-metrics.delivered-metrics.opened-metrics.clicked-metrics.unsub }
  ];

  const recent = useMemo(
    () =>
      [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 250),
    [rows]
  );

  return (
    <>
      <Head><title>Campaigns Analytics</title></Head>
      <div style={styles.page}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{ width: 1320, maxWidth: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#14b8a6', borderRadius: 18, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>📣</div>
              <div>
                <div style={{ fontSize: 48, fontWeight: 500, color: '#ffffff', margin: 0 }}>Campaigns</div>
                <div style={{ fontSize: 18, color: '#ffffff', opacity: 1, margin: '4px 0 0 0' }}>Multi-step email campaigns and sequences</div>
              </div>
            </div>
            <Link href="/modules/email/reports" style={{ background: '#000000', color: '#ffffff', padding: '10px 16px', borderRadius: 999, textDecoration: 'none', fontWeight: 500, border: 'none', fontSize: 18 }}>← Back</Link>
          </div>
        </div>
        <div style={styles.container}>

          <div style={styles.rangeRow}>
            {["today","d7","d30","d90","all"].map(r=>(
              <button key={r} onClick={()=>setRange(r)}
                style={{...styles.rangeBtn, ...(range===r?styles.rangeActive:{})}}>
                {r==="today"?"Today":r==="d7"?"Last 7 days":r==="d30"?"Last 30 days":r==="d90"?"Last 90 days":"All time"}
              </button>
            ))}
            <div style={{flex:1}}/>
            <button onClick={()=>setChartType(chartType==="line"?"pie":"line")} style={styles.toggleBtn}>
              {chartType==="line"?"View pie chart":"View line chart"}
            </button>
          </div>

          <div style={styles.metricsRow}>
            {["Sent","Delivered","Opened","Clicked","Unsubscribed"].map(k=>(
              <Metric key={k} label={k} value={metrics[k.toLowerCase()]}/>
            ))}
          </div>

          <div style={styles.chartWrap}>
            <div style={styles.chartTitle}>campaigns performance</div>
            {chartType==="line" ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <XAxis dataKey="date"/><YAxis allowDecimals={false}/>
                  <Tooltip/><Legend/>
                  <Line dataKey="sent" stroke="#94a3b8" strokeWidth={2}/>
                  <Line dataKey="delivered" stroke="#22c55e" strokeWidth={2}/>
                  <Line dataKey="opened" stroke="#3b82f6" strokeWidth={2}/>
                  <Line dataKey="clicked" stroke="#facc15" strokeWidth={2}/>
                  <Line dataKey="unsub" stroke="#ef4444" strokeWidth={2}/>
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Tooltip/><Legend/>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110}>
                    {pieData.map((_,i)=><Cell key={i} fill={PIE_COLOURS[i]}/>)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={styles.tableWrap}>
            <div style={styles.tableHeadRow}>
              <div style={styles.th}>When</div>
              <div style={styles.th}>Email</div>
              <div style={styles.th}>Campaign</div>
              <div style={styles.th}>Delivered</div>
              <div style={styles.th}>Open</div>
              <div style={styles.th}>Click</div>
              <div style={styles.th}>Unsub</div>
              <div style={styles.th}>Status</div>
            </div>
            {recent.length === 0 ? (
              <div style={styles.tableEmpty}>No campaign rows found for this period.</div>
            ) : (
              recent.map((r) => {
                const when = r.last_event_at || r.created_at;
                const deliveredYes = ["delivered", "opened", "clicked"].includes(String(r.status || "").toLowerCase());
                const cName = nameMap[r.campaign_id] || "Campaign";
                return (
                  <div key={r.id} style={styles.tr}>
                    <div style={styles.td}>{when ? new Date(when).toLocaleString() : "—"}</div>
                    <div style={styles.td}>{r.email || "—"}</div>
                    <div style={styles.td} title={cName}>{cName}</div>
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
        </div>
      </div>
    </>
  );
}

function Metric({label,value}) {
  return (
    <div style={styles.metricBox}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

const styles = {
  page:{minHeight:"100vh",background:"radial-gradient(circle at top, rgba(15,23,42,0.9), rgba(2,6,23,1))",padding:20,color:"#e6eef8",fontSize:16},
  container:{maxWidth:1320,margin:"0 auto"},
  rangeRow:{marginTop:12,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"},
  rangeBtn:{fontSize:16,padding:"6px 12px",borderRadius:999,border:"1px solid rgba(255,255,255,0.18)",background:"rgba(2,6,23,0.6)",color:"#fff",cursor:"pointer",fontWeight:600},
  rangeActive:{background:"rgba(20,184,166,0.20)",border:"1px solid rgba(20,184,166,0.55)"},
  toggleBtn:{fontSize:16,padding:"10px 16px",borderRadius:999,background:"rgba(2,6,23,0.75)",border:"1px solid rgba(255,255,255,0.18)",color:"#e6eef8",cursor:"pointer",fontWeight:700,whiteSpace:"nowrap"},
  metricsRow:{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginTop:14},
  metricBox:{padding:12,borderRadius:12,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.10)"},
  metricLabel:{fontSize:16,opacity:0.85,fontWeight:700},
  metricValue:{fontSize:16,fontWeight:700,marginTop:6},
  chartWrap:{marginTop:14,padding:14,borderRadius:14,background:"rgba(2,6,23,0.55)",border:"1px solid rgba(255,255,255,0.10)"},
  chartTitle:{fontSize:18,fontWeight:600,marginBottom:8},
  tableWrap:{marginTop:14,borderRadius:12,overflow:"hidden",border:"1px solid rgba(255,255,255,0.10)"},
  tableHeadRow:{display:"grid",gridTemplateColumns:"1.4fr 2fr 2fr .8fr .6fr .6fr .6fr 1fr",padding:"10px 12px",background:"rgba(255,255,255,0.06)"},
  th:{fontSize:16,fontWeight:700,opacity:0.9},
  tr:{display:"grid",gridTemplateColumns:"1.4fr 2fr 2fr .8fr .6fr .6fr .6fr 1fr",padding:"10px 12px",background:"rgba(2,6,23,0.45)",borderTop:"1px solid rgba(255,255,255,0.08)"},
  td:{fontSize:16,opacity:0.92,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  tableEmpty:{padding:12,fontSize:16,opacity:0.85,background:"rgba(2,6,23,0.45)"}
};
