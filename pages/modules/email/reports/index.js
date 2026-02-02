// /pages/modules/email/reports/index.js
// Email analytics control centre — collapsible section summaries + drill-down.
// LIVE version (reads from email_sends and sms_sends).
//
// Routes:
// - /modules/email/reports/all
// - /modules/email/reports/broadcasts
// - /modules/email/reports/campaigns
// - /modules/email/reports/autoresponders
// - /modules/email/reports/automations
// - /modules/email/reports/crm-sms

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../utils/supabase-client";

const RANGE_TO_DAYS = {
  today: 0,
  d7: 7,
  d30: 30,
  d90: 90,
  all: null,
};

function isoDaysAgo(days) {
  if (days === null || days === undefined) return null;
  const d = new Date();
  if (days === 0) {
    // start of today (local)
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// Choose best timestamp column we can rely on
// We prefer last_event_at (webhook-driven), then created_at.
function buildTimeFilterQuery(q, fromIso) {
  if (!fromIso) return q;
  // We can't do OR conditions easily in supabase query builder,
  // so we filter on created_at (always present) and order by last_event_at when available.
  return q.gte("created_at", fromIso);
}

function calcMetrics(rows) {
  const total = rows.length;

  const opens = rows.filter((r) => Number(r.open_count || 0) > 0).length;
  const clicks = rows.filter((r) => Number(r.click_count || 0) > 0).length;
  const bounced = rows.filter((r) => !!r.bounced_at || r.last_event === "bounce" || r.last_event === "dropped").length;
  const unsub = rows.filter((r) => !!r.unsubscribed).length;

  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return {
    sent: total,
    opened: pct(opens),
    clicked: pct(clicks),
    bounced: pct(bounced),
    unsub: pct(unsub),
  };
}

// SMS-specific metric calculation (robust to variations in column names)
function calcSmsMetrics(rows) {
  const total = rows.length;

  const delivered = rows.filter(
    (r) => !!r.delivered_at || r.delivery_status === "delivered" || r.last_event === "delivered"
  ).length;

  const failed = rows.filter(
    (r) => r.delivery_status === "failed" || r.last_event === "failed" || !!r.failed_at
  ).length;

  const replied = rows.filter((r) => Number(r.reply_count || r.replies || 0) > 0 || !!r.replied).length;

  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  // Map into the generic keys used by the UI so SectionCard can render without structural changes
  return {
    sent: total,
    opened: pct(delivered), // displayed as "Delivered" via card labels
    clicked: pct(replied), // displayed as "Replies"
    bounced: pct(failed), // displayed as "Failed"
    unsub: 0,
  };
}

export default function EmailReportsControlCentre() {
  const [range, setRange] = useState("all");

  // Multiple open sections (stay open until closed)
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [rowsAll, setRowsAll] = useState([]);
  const [rowsBroadcasts, setRowsBroadcasts] = useState([]);
  const [rowscampaigns, setRowscampaigns] = useState([]);
  const [rowsAutoresponders, setRowsAutoresponders] = useState([]);
  const [rowsAutomations, setRowsAutomations] = useState([]);

  // SMS rows state
  const [rowsSms, setRowsSms] = useState([]);

  // Recent combined rows (email + sms) for the table
  const [recentRows, setRecentRows] = useState([]);

  // Cards only for modules that can send/receive data (emails + CRM/SMS)
  const cards = useMemo(
    () => [
      {
        key: "all",
        title: "All email types (Total)",
        desc: "Combined analytics across all email types.",
        href: "/modules/email/reports/all",
        colour: "#10b981",
        icon: "📊",
        metricLabels: ["Sent", "Opened", "Clicked", "Bounced", "Unsubscribed"],
      },
      {
        key: "broadcasts",
        title: "Broadcasts",
        desc: "One-off broadcast emails sent to lists or specific contacts.",
        href: "/modules/email/reports/broadcasts",
        colour: "#f59e0b",
        icon: "📢",
        metricLabels: ["Sent", "Opened", "Clicked", "Bounced", "Unsubscribed"],
      },
      {
        key: "campaigns",
        title: "Campaigns",
        desc: "Multi-step email campaigns and sequences.",
        href: "/modules/email/reports/campaigns",
        colour: "#14b8a6",
        icon: "📣",
        metricLabels: ["Sent", "Opened", "Clicked", "Bounced", "Unsubscribed"],
      },
      {
        key: "autoresponders",
        title: "Autoresponders",
        desc: "Autoresponder emails triggered by sign-ups or events.",
        href: "/modules/email/reports/autoresponders",
        colour: "#a855f7",
        icon: "⏱️",
        metricLabels: ["Sent", "Opened", "Clicked", "Bounced", "Unsubscribed"],
      },
      {
        key: "automations",
        title: "Automations",
        desc: "Emails sent from automation flows and rules.",
        href: "/modules/email/reports/automations",
        colour: "#f97316",
        icon: "⚙️",
        metricLabels: ["Sent", "Opened", "Clicked", "Bounced", "Unsubscribed"],
      },
      {
        key: "crm_sms",
        title: "CRM & SMS",
        desc: "Contacts, tags and SMS messaging activity.",
        href: "/modules/email/reports/crm-sms",
        colour: "#06b6d4",
        icon: "📱",
        // metricLabels are used to render meaningful labels for SMS (mapped from internal keys)
        metricLabels: ["Sent", "Delivered", "Replies", "Failed", "Opt-outs"],
      },
    ],
    []
  );

  const allOpen = useMemo(() => cards.every((c) => openKeys.has(c.key)), [cards, openKeys]);

  const toggle = (key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setOpenKeys(new Set(cards.map((c) => c.key)));
  const collapseAll = () => setOpenKeys(new Set());

  const fromIso = useMemo(() => {
    const days = RANGE_TO_DAYS[range];
    return isoDaysAgo(days);
  }, [range]);

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
          setRowsAll([]);
          setRowsBroadcasts([]);
          setRowscampaigns([]);
          setRowsAutoresponders([]);
          setRowsAutomations([]);
          setRowsSms([]);
          setRecentRows([]);
          setLoading(false);
          return;
        }

        // Base query for time filter
        const base = (q) => buildTimeFilterQuery(q.eq("user_id", uid), fromIso);

        // Pull all email_sends rows for metrics (limit high enough for dashboards)

        const qAll = base(
          supabase
            .from("email_sends")
            .select(
              "id, user_id, email, broadcast_id, campaign_id, automation_id, open_count, click_count, bounced_at, unsubscribed, last_event, last_event_at, created_at"
            )
            .order("created_at", { ascending: false })
            .limit(5000)
        );

        const { data: allData, error: allErr } = await qAll;
        if (allErr) throw allErr;

        const broadcasts = (allData || []).filter((r) => !!r.broadcast_id);
        const campaigns = (allData || []).filter((r) => !!r.campaign_id);
        // NOTE: autoresponders reserved (no dedicated flag in email_sends by default)
        const autoresponders = []; // reserved for a dedicated id/flag
        const automations = (allData || []).filter((r) => !!r.automation_id);

        // Attempt to fetch SMS rows from sms_sends (best-effort; tolerate missing table)
        let smsData = [];
        try {
          const { data: smsResp, error: smsErr } = await supabase
            .from("sms_sends")
            .select("id, user_id, phone, message, delivery_status, delivered_at, failed_at, reply_count, last_event, created_at")
            .order("created_at", { ascending: false })
            .limit(5000);

          if (smsErr) {
            // If the sms table doesn't exist or other non-fatal issue, continue without SMS
            // don't throw — SMS is optional for some installs
            smsData = [];
          } else {
            smsData = smsResp || [];
          }
        } catch (e) {
          smsData = [];
        }

        if (!mounted) return;

        setRowsAll(allData || []);
        setRowsBroadcasts(broadcasts);
        setRowscampaigns(campaigns);
        setRowsAutoresponders(autoresponders);
        setRowsAutomations(automations);
        setRowsSms(smsData || []);

        // Recent combined table (email + sms), normalized to include _type for rendering
        const combined = []
          .concat(
            (allData || []).map((r) => ({
              ...r,
              _type: "email",
            }))
          )
          .concat(
            (smsData || []).map((s) => ({
              ...s,
              _type: "sms",
            }))
          )
          .sort((a, b) => {
            const ta = new Date(a.last_event_at || a.created_at || 0).getTime();
            const tb = new Date(b.last_event_at || b.created_at || 0).getTime();
            return tb - ta;
          });

        setRecentRows(combined.slice(0, 30));

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

  const pillsAll = useMemo(() => calcMetrics(rowsAll), [rowsAll]);
  const pillsBroadcasts = useMemo(() => calcMetrics(rowsBroadcasts), [rowsBroadcasts]);
  const pillscampaigns = useMemo(() => calcMetrics(rowscampaigns), [rowscampaigns]);
  const pillsAutoresponders = useMemo(() => calcMetrics(rowsAutoresponders), [rowsAutoresponders]);
  const pillsAutomations = useMemo(() => calcMetrics(rowsAutomations), [rowsAutomations]);
  const pillsSms = useMemo(() => calcSmsMetrics(rowsSms), [rowsSms]);

  const pillsByKey = {
    all: pillsAll,
    broadcasts: pillsBroadcasts,
    campaigns: pillscampaigns,
    autoresponders: pillsAutoresponders,
    automations: pillsAutomations,
    crm_sms: pillsSms,
  };

  return (
    <>
      <Head>
        <title>Email analytics control centre</title>
      </Head>

      <div style={styles.page}>
        <div style={styles.container}>
          {/* Banner (standard spec) */}
          <div style={styles.banner}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={styles.bannerIconWrap} aria-hidden="true">
                <span style={{ fontSize: 48, lineHeight: 1 }}>📊</span>
              </div>
              <div>
                <div style={styles.bannerTitle}>Email analytics control centre</div>
                <div style={styles.bannerSub}>
                  Broadcasts, campaigns, autoresponders, automations — all your key email stats in one dashboard.
                </div>
              </div>
            </div>

            <Link href="/modules/email" style={styles.backBtn}>
              ← Back
            </Link>
          </div>

          {/* Time filters + expand/collapse */}
          <div style={styles.rangeRow}>
            <div style={styles.rangeLabel}>Time period:</div>
            <RangePill label="Today" active={range === "today"} onClick={() => setRange("today")} />
            <RangePill label="Last 7 days" active={range === "d7"} onClick={() => setRange("d7")} />
            <RangePill label="Last 30 days" active={range === "d30"} onClick={() => setRange("d30")} />
            <RangePill label="Last 90 days" active={range === "d90"} onClick={() => setRange("d90")} />
            <RangePill label="All time" active={range === "all"} onClick={() => setRange("all")} />

            <div style={{ flex: 1 }} />

            <button
              type="button"
              onClick={allOpen ? collapseAll : expandAll}
              style={styles.expandBtn}
              title={allOpen ? "Collapse all sections" : "Expand all sections"}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>

          {loading ? <div style={styles.note}>Loading live analytics…</div> : null}

          {!loading && !userId ? (
            <div style={styles.note}>You must be logged in to view analytics.</div>
          ) : null}

          {!loading && loadErr ? (
            <div style={{ ...styles.note, border: "1px solid rgba(239,68,68,0.55)", background: "rgba(239,68,68,0.12)" }}>
              Error loading analytics: {loadErr}
            </div>
          ) : null}

          {!loading && userId && !loadErr ? (
            <div style={styles.note}>
              Live data from <code>email_sends</code> and <code>sms_sends</code> (if available). (If something reads 0,
              it means that type hasn’t written into the corresponding table yet.)
            </div>
          ) : null}

          {/* Sections (collapsible) */}
          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            {cards.map((c) => (
              <SectionCard
                key={c.key}
                card={c}
                pills={pillsByKey[c.key]}
                isOpen={openKeys.has(c.key)}
                onToggle={() => toggle(c.key)}
              />
            ))}
          </div>

          {/* Recent */}
          <div style={styles.recentWrap}>
            <div style={styles.recentTitle}>Recent sends (Email & SMS)</div>
            <div style={styles.recentSub}>
              Showing the last {recentRows.length} rows from <code>email_sends</code> and <code>sms_sends</code> for this
              period.
            </div>

            {!recentRows.length ? (
              <div style={styles.recentEmpty}>
                No rows found in <code>email_sends</code> or <code>sms_sends</code> yet for this time range.
              </div>
            ) : (
              <div style={styles.tableWrap}>
                <div style={styles.tableHeadRow}>
                  <div style={styles.th}>When</div>
                  <div style={styles.th}>Recipient</div>
                  <div style={styles.th}>Type</div>
                  <div style={styles.th}>Opens / Delivered</div>
                  <div style={styles.th}>Clicks / Replies</div>
                  <div style={styles.th}>Last event</div>
                </div>

                {recentRows.map((r) => {
                  const isSms = r._type === "sms";
                  const type = isSms
                    ? "SMS"
                    : r.broadcast_id
                    ? "Broadcast"
                    : r.campaigns_id
                    ? "Campaign"
                    : r.automation_id
                    ? "Automation"
                    : "Email";

                  const when = r.last_event_at || r.created_at;
                  const recipient = isSms ? r.phone || "—" : r.email || "—";

                  const opensCell = isSms
                    ? r.delivered_at || r.delivery_status === "delivered" || r.last_event === "delivered"
                      ? 1
                      : 0
                    : Number(r.open_count || 0);

                  const clicksCell = isSms ? Number(r.reply_count || r.replies || 0) : Number(r.click_count || 0);

                  const lastEvent = r.last_event || r.delivery_status || "—";

                  return (
                    <div key={`${r._type}-${r.id}`} style={styles.tr}>
                      <div style={styles.td}>{when ? new Date(when).toLocaleString() : "—"}</div>
                      <div style={styles.td}>{recipient}</div>
                      <div style={styles.td}>{type}</div>
                      <div style={styles.td}>{opensCell}</div>
                      <div style={styles.td}>{clicksCell}</div>
                      <div style={styles.td}>{lastEvent}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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

function Pill({ label, value }) {
  return (
    <div style={styles.pill}>
      <span style={styles.pillLabel}>{label}:</span>
      <span style={styles.pillValue}>{value}</span>
    </div>
  );
}

function SectionCard({ card, pills, isOpen, onToggle }) {
  const safeColour = card.colour || "#10b981";
  const p = pills || { sent: 0, opened: 0, clicked: 0, bounced: 0, unsub: 0 };

  const defaultLabels = ["Sent", "Opened", "Clicked", "Bounced", "Unsubscribed"];
  const labels = card.metricLabels || defaultLabels;

  return (
    <div style={{ ...styles.sectionCard, border: `1px solid rgba(255,255,255,0.10)` }}>
      {/* Header = click to collapse/expand (NO navigation) */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          ...styles.sectionHeaderBtn,
          background: safeColour,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={styles.sectionIconWrap} aria-hidden="true">
            <span style={{ fontSize: 24, lineHeight: 1 }}>{card.icon || "📊"}</span>
          </div>

          <div style={{ textAlign: "left" }}>
            <div style={styles.sectionTitle}>{card.title}</div>
            <div style={styles.sectionDesc}>{card.desc}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Drill-down link (does not affect collapse state) */}
          <Link
            href={card.href}
            style={styles.viewBtn}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            View report →
          </Link>

          <div style={styles.chev} aria-hidden="true">
            {isOpen ? "▾" : "▸"}
          </div>
        </div>
      </button>

      {/* Collapsible content */}
      {isOpen ? (
        <div style={styles.sectionBody}>
          <div style={styles.sectionPillsRow}>
            <Pill label={labels[0]} value={p.sent ?? 0} />
            <Pill label={labels[1]} value={`${p.opened ?? 0}%`} />
            <Pill label={labels[2]} value={`${p.clicked ?? 0}%`} />
            <Pill label={labels[3]} value={`${p.bounced ?? 0}%`} />
            <Pill label={labels[4]} value={`${p.unsub ?? 0}%`} />
          </div>

          <div style={styles.summaryGrid}>
            <SummaryBox title={labels[0]} value={p.sent ?? 0} />
            <SummaryBox title={labels[1]} value={`${p.opened ?? 0}%`} />
            <SummaryBox title={labels[2]} value={`${p.clicked ?? 0}%`} />
            <SummaryBox title={labels[3]} value={`${p.bounced ?? 0}%`} />
            <SummaryBox title={labels[4]} value={`${p.unsub ?? 0}%`} />
          </div>

          <div style={{ marginTop: 12 }}>
            <Link href={card.href} style={styles.deepLink}>
              Open full {card.title} report →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryBox({ title, value }) {
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
    fontSize: 18,
  },
  container: { maxWidth: 1320, margin: "0 auto" },

  // Main banner (standard)
  banner: {
    width: "100%",
    borderRadius: 18,
    padding: "16px 18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#10b981",
  },
  bannerIconWrap: {
    width: 69,
    height: 69,
    display: "grid",
    placeItems: "center",
    borderRadius: 10,
    background: "rgba(0,0,0,0.18)",
  },
  bannerTitle: { fontSize: 48, fontWeight: 600, color: "#052b1b", lineHeight: 1.05 },
  bannerSub: { fontSize: 18, marginTop: 3, color: "rgba(5,43,27,0.90)" },

  backBtn: {
    background: "rgba(2,6,23,0.75)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "10px 16px",
    fontSize: 18,
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.18)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 600,
  },

  rangeRow: {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  rangeLabel: { fontSize: 18, opacity: 0.9 },

  rangePill: {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(2,6,23,0.55)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 18,
    cursor: "pointer",
    fontWeight: 600,
  },
  rangePillActive: {
    background: "rgba(16,185,129,0.20)",
    border: "1px solid rgba(16,185,129,0.55)",
  },

  expandBtn: {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(2,6,23,0.75)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "10px 16px",
    fontSize: 18,
    cursor: "pointer",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  note: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(2,6,23,0.55)",
    border: "1px solid rgba(255,255,255,0.10)",
    fontSize: 18,
    opacity: 0.95,
  },

  sectionCard: {
    borderRadius: 14,
    background: "rgba(2,6,23,0.55)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    overflow: "hidden",
  },

  sectionHeaderBtn: {
    width: "100%",
    border: "none",
    padding: "12px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    color: "#052b1b",
  },

  sectionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "rgba(0,0,0,0.18)",
  },

  sectionTitle: { fontSize: 24, fontWeight: 600, color: "#052b1b" },
  sectionDesc: { fontSize: 18, color: "rgba(5,43,27,0.90)", marginTop: 2 },

  viewBtn: {
    background: "rgba(2,6,23,0.80)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: 18,
    border: "1px solid rgba(255,255,255,0.18)",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontWeight: 700,
  },

  chev: {
    width: 34,
    height: 34,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "rgba(2,6,23,0.25)",
    border: "1px solid rgba(2,6,23,0.35)",
    color: "rgba(2,6,23,0.85)",
    fontWeight: 900,
  },

  sectionBody: {
    padding: "12px 12px 14px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },

  sectionPillsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  pill: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 18,
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  pillLabel: { opacity: 0.9 },
  pillValue: { fontWeight: 800 },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 10,
  },

  metricBox: {
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  metricTitle: { fontSize: 18, opacity: 0.85, fontWeight: 700 },
  metricValue: { fontSize: 18, fontWeight: 800, marginTop: 6 },

  deepLink: {
    display: "inline-block",
    textDecoration: "none",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#e6eef8",
    borderRadius: 999,
    padding: "10px 16px",
    fontSize: 18,
    fontWeight: 700,
  },

  recentWrap: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    background: "rgba(2,6,23,0.55)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  recentTitle: { fontSize: 18, fontWeight: 900 },
  recentSub: { fontSize: 18, opacity: 0.9, marginTop: 3 },
  recentEmpty: { fontSize: 18, opacity: 0.8, marginTop: 8 },

  tableWrap: {
    marginTop: 10,
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  tableHeadRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 2fr 1fr 0.8fr 0.8fr 1fr",
    gap: 0,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.06)",
  },
  th: { fontSize: 18, fontWeight: 900, opacity: 0.9 },
  tr: {
    display: "grid",
    gridTemplateColumns: "1.4fr 2fr 1fr 0.8fr 0.8fr 1fr",
    gap: 0,
    padding: "10px 12px",
    background: "rgba(2,6,23,0.45)",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  td: { fontSize: 18, opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};