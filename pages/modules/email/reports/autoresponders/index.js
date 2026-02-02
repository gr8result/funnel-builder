
// Style definitions
const styles = {
  page: { background: '#000000', minHeight: '100vh', padding: 32 },
  container: { maxWidth: 1400, margin: '0 auto', background: 'rgba(5, 5, 5, 0.01)', borderRadius: 18, padding: 32 },
  rangeRow: { display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0 18px' },
  rangeLabel: { fontSize: 18, fontWeight: 600, marginRight: 8 },
  rangePill: { padding: '7px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 500, fontSize: 16, cursor: 'pointer', border: 'none', marginRight: 6 },
  rangePillActive: { background: '#a855f7', color: '#fff' },
  note: { fontSize: 18, opacity: 0.85, margin: '18px 0', padding: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 8 },
  metricsGrid: { display: 'flex', gap: 24, margin: '32px 0 18px' },
  metricBox: { background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '18px 32px', minWidth: 160, textAlign: 'center' },
  metricTitle: { fontSize: 18, opacity: 0.85, marginBottom: 6 },
  metricValue: { fontSize: 32, fontWeight: 700, color: '#a855f7' },
  tableWrap: { marginTop: 32, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' },
  tableHeadRow: { display: 'grid', gridTemplateColumns: '1.4fr 2fr 1.2fr 0.6fr 0.6fr 1fr', padding: '10px 12px', background: 'rgba(255,255,255,0.06)' },
  th: { fontSize: 18, fontWeight: 900, opacity: 0.9 },
  tr: { display: 'grid', gridTemplateColumns: '1.4fr 2fr 1.2fr 0.6fr 0.6fr 1fr', padding: '10px 12px', background: 'rgba(2,6,23,0.45)', borderTop: '1px solid rgba(255,255,255,0.08)' },
  td: { fontSize: 18, opacity: 0.92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tableEmpty: { padding: 12, fontSize: 18, opacity: 0.85, background: 'rgba(2,6,23,0.45)' },
};
// /pages/modules/email/reports/autoresponders.js
// Full report: Autoresponders — reads from email_sends (autoresponder_id OR source_type=autoresponder)

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../../utils/supabase-client";

const RANGE_TO_DAYS = { today: 0, d7: 7, d30: 30, d90: 90, all: null };

function isoDaysAgo(days) {
  if (days === null || days === undefined) return null;
  const d = new Date();
  if (days === 0) {
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function buildTimeFilterQuery(q, fromIso) {
  if (!fromIso) return q;
  return q.gte("created_at", fromIso);
}
function calcMetrics(rows) {
  const total = rows.length;
  const opens = rows.filter((r) => Number(r.open_count || 0) > 0).length;
  const clicks = rows.filter((r) => Number(r.click_count || 0) > 0).length;
  const bounced = rows.filter((r) => !!r.bounced_at || r.last_event === "bounce" || r.last_event === "dropped").length;
  const unsub = rows.filter((r) => !!r.unsubscribed).length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return { sent: total, opened: pct(opens), clicked: pct(clicks), bounced: pct(bounced), unsub: pct(unsub) };
}

export default function AutorespondersReport() {
  const [range, setRange] = useState("all");
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [rows, setRows] = useState([]);

  const fromIso = useMemo(() => isoDaysAgo(RANGE_TO_DAYS[range]), [range]);
  const metrics = useMemo(() => calcMetrics(rows), [rows]);
  const recentRows = useMemo(() => (rows || []).slice(0, 100), [rows]);

  const hasIdentifier = useMemo(() => {
    // If ANY row has autoresponder_id or source_type, we can classify.
    return rows.some((r) => r?.autoresponder_id) || rows.some((r) => String(r?.source_type || "").toLowerCase() === "autoresponder");
  }, [rows]);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      setLoadErr(null);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        if (!mounted) return;
        setUserId(uid);

        if (!uid) {
          setRows([]);

          setLoading(false);
          return;
        }

        const base = (q) => buildTimeFilterQuery(q.eq("user_id", uid), fromIso);

        // Query 1: Get all emails
        const q1 = base(
          supabase
            .from("email_sends")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(10000)
        );

        const { data: data1, error: error1 } = await q1;
        if (error1) throw error1;

        // Query 2: Get all valid autoresponder IDs from the queue (these are the ones we track)
        const { data: queueData, error: qErr } = await supabase
          .from("email_autoresponder_queue")
          .select("autoresponder_id")
          .eq("user_id", uid)
          .not("autoresponder_id", "is", null);
        
        if (qErr) throw qErr;
        const validAutoresponderIds = new Set((queueData || []).map((r) => r.autoresponder_id).filter(Boolean));

        // Filter: show emails that either have autoresponder_id (from recent sends) OR belong to a known autoresponder
        const filtered = (data1 || []).filter((r) => {
          if (r?.autoresponder_id && validAutoresponderIds.has(r.autoresponder_id)) return true;
          const st = String(r?.source_type || "").toLowerCase();
          return st === "autoresponder";
        });

        if (!mounted) return;
        setRows(filtered);
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setLoadErr(String(e?.message || e));
        setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [fromIso]);

  return (
    <>
      <Head><title>Autoresponder analytics</title></Head>

      <div style={styles.page}>
        <div style={styles.container}>
          <div style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            marginBottom: 24,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              background: "#a855f7",
              borderRadius: 18,
              padding: "20px 24px",
              color: "#fff",
              width: 1320,
              maxWidth: '100%',
              gap: 18,
              border: 'none',
              justifyContent: 'space-between'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18
              }}>
                <div style={{
                  width: 48,
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  fontSize: 48,
                }}>
                  <span role="img" aria-label="Autoresponder" style={{ fontSize: 48 }}>⏱️</span>
                </div>
                <div>
                  <div style={{ fontSize: 32, margin: 0, color: '#fff', fontWeight: 600 }}>Autoresponders</div>
                  <div style={{ fontSize: 16, margin: "4px 0 0", opacity: 0.92, color: '#fff' }}>View and manage your timed email sequences.</div>
                </div>
              </div>
              <a href="/modules/email/reports" style={{ background: "rgba(0,0,0,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", padding: "8px 16px", borderRadius: 999, cursor: "pointer", fontWeight: 500, textDecoration: "none", whiteSpace: 'nowrap' }}>← Back</a>
            </div>
          </div>

          <div style={styles.rangeRow}>
            <div style={styles.rangeLabel}>Time period:</div>
            <RangePill label="Today" active={range === "today"} onClick={() => setRange("today")}/>
            <RangePill label="Last 7 days" active={range === "d7"} onClick={() => setRange("d7")}/>
            <RangePill label="Last 30 days" active={range === "d30"} onClick={() => setRange("d30")}/>
            <RangePill label="Last 90 days" active={range === "d90"} onClick={() => setRange("d90")}/>
            <RangePill label="All time" active={range === "all"} onClick={() => setRange("all")}/>
          </div>

          {loading ? <div style={styles.note}>Loading…</div> : null}
          {!loading && !userId ? <div style={styles.note}>You must be logged in to view analytics.</div> : null}
          {!loading && loadErr ? <div style={{ ...styles.note, border: "1px solid rgba(239,68,68,0.55)", background: "rgba(239,68,68,0.12)" }}>Error: {loadErr}</div> : null}

          {!loading && userId && !loadErr ? (
            <>
              {!hasIdentifier && rows.length === 0 ? (
                <div style={styles.note}>
                  No autoresponder activity found for this period.
                </div>
              ) : null}

              <div style={styles.metricsGrid}>
                <Metric title="Sent" value={metrics.sent} />
                <Metric title="Opened" value={`${metrics.opened}%`} />
                <Metric title="Clicked" value={`${metrics.clicked}%`} />
                <Metric title="Bounced" value={`${metrics.bounced}%`} />
                <Metric title="Unsubscribed" value={`${metrics.unsub}%`} />
              </div>

              <div style={styles.tableWrap}>
                <div style={styles.tableHeadRow}>
                  <div style={styles.th}>When</div>
                  <div style={styles.th}>Email</div>
                  <div style={styles.th}>Identifier</div>
                  <div style={styles.th}>Open</div>
                  <div style={styles.th}>Click</div>
                  <div style={styles.th}>Last event</div>
                </div>

                {recentRows.length === 0 ? (
                  <div style={styles.tableEmpty}>No autoresponder rows found in <code>email_sends</code> for this period.</div>
                ) : (
                  recentRows.map((r) => {
                    const when = r.last_event_at || r.created_at;
                    const ident = r.autoresponder_id || (r.source_type ? String(r.source_type) : "—");
                    return (
                      <div key={r.id} style={styles.tr}>
                        <div style={styles.td}>{when ? new Date(when).toLocaleString() : "—"}</div>
                        <div style={styles.td}>{r.email || "—"}</div>
                        <div style={styles.td}>{ident}</div>
                        <div style={styles.td}>{Number(r.open_count || 0)}</div>
                        <div style={styles.td}>{Number(r.click_count || 0)}</div>
                        <div style={styles.td}>{r.last_event || "—"}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : null}
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



