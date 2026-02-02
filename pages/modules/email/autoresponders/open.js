// /pages/modules/email/autoresponders/open.js
// FULL REPLACEMENT
//
// ✅ Keeps the PURPLE 1320 banner EXACTLY as-is (same layout + sizing)
// ✅ Centers content under banner
// ✅ Increases table/page width to 1400px
// ✅ Minimum font size across the whole page = 16px (no tiny text)
// ✅ Shows Stats column (Queued/Pending/Sent/Failed + last sent + opens if available)
// ✅ Uses /api/email/autoresponders/stats (Bearer token)
// ✅ Lists autoresponders from email_automations for the logged-in user
// ✅ Action buttons: Edit emails / Edit details / Delete (same vibe as your screenshot)

import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../utils/supabase-client";

function s(v) {
  return String(v ?? "").trim();
}

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function AutorespondersOpen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [rows, setRows] = useState([]); // email_automations
  const [statsMap, setStatsMap] = useState({}); // { [autoresponder_id]: stats }

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function loadAll() {
    setLoading(true);
    setMsg("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRows([]);
        setStatsMap({});
        setMsg("You must be logged in.");
        return;
      }

      // Load autoresponders
      const { data: autos, error: aErr } = await supabase
        .from("email_automations")
        .select(
          "id,name,subject,trigger_type,send_day,send_time,active_days,list_id,created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (aErr) throw aErr;

      const listIds = Array.from(
        new Set((autos || []).map((x) => x.list_id).filter(Boolean))
      );

      // Load list names for display
      let listNameById = {};
      if (listIds.length) {
        const { data: lists, error: lErr } = await supabase
          .from("lead_lists")
          .select("id,name")
          .in("id", listIds);

        if (!lErr && Array.isArray(lists)) {
          for (const l of lists) listNameById[l.id] = l.name;
        }
      }

      const mapped = (autos || []).map((x) => ({
        ...x,
        list_name: listNameById[x.list_id] || "—",
      }));

      setRows(mapped);

      // Load stats via API (Bearer)
      const token = await getToken();
      if (token) {
        const r = await fetch("/api/email/autoresponders/stats", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok && Array.isArray(j.data)) {
          const m = {};
          for (const st of j.data) {
            if (st?.autoresponder_id) m[st.autoresponder_id] = st;
          }
          setStatsMap(m);
        } else {
          // keep UI working even if stats fails
          setStatsMap({});
        }
      } else {
        setStatsMap({});
      }
    } catch (e) {
      console.error(e);
      setMsg(`Error loading autoresponders: ${e?.message || String(e)}`);
      setRows([]);
      setStatsMap({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteAutoresponder(id) {
    if (!id) return;
    const ok = window.confirm("Delete this autoresponder?");
    if (!ok) return;

    try {
      setMsg("");
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setMsg("You must be logged in.");
        return;
      }

      // delete queue rows first (safe cleanup)
      await supabase.from("email_autoresponder_queue").delete().eq("autoresponder_id", id);

      // delete automation itself
      const { error } = await supabase
        .from("email_automations")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) throw error;

      setMsg("Deleted.");
      await loadAll();
    } catch (e) {
      console.error(e);
      setMsg(`Delete failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const displayRows = useMemo(() => rows || [], [rows]);

  return (
    <>
      <Head>
        <title>Autoresponders - GR8 RESULT Digital Solutions</title>
      </Head>

      {/* Banner (LEAVE EXACTLY AS IS) */}
      <div className="banner-wrapper">
        <div className="banner">
          <div className="banner-left">
            <span className="icon">⏱️</span>
            <div>
              <h1 className="title">Autoresponders</h1>
              <p className="subtitle">View and manage your timed email sequences.</p>
            </div>
          </div>

          <div className="banner-actions">
            <button className="back" onClick={() => router.back()}>
              ← Back
            </button>
            <button
              className="new"
              onClick={() => router.push("/modules/email/autoresponders")}
            >
              + New Autoresponder
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="page-wrap">
        <div className="table-wrap">
          <div className="table-card">
            <div className="table-head">
              <div className="th name">Name</div>
              <div className="th subject">Subject</div>
              <div className="th timing">Trigger &amp; Timing</div>
              <div className="th list">List</div>
              <div className="th days">Days</div>
              <div className="th stats">Stats</div>
              <div className="th actions">Actions</div>
            </div>

            {loading ? (
              <div className="loading">Loading…</div>
            ) : !displayRows.length ? (
              <div className="empty">No autoresponders found.</div>
            ) : (
              displayRows.map((r) => {
                const st = statsMap?.[r.id] || null;
                const queued = Number(st?.queued || 0);
                const pending = Number(st?.pending || 0);
                const sent = Number(st?.sent || 0);
                const failed = Number(st?.failed || 0);
                const lastSent = st?.last_sent_at ? fmtDate(st.last_sent_at) : "-";
                const opensTotal = Number(st?.opens_total || 0);
                const opensUnique = Number(st?.opens_unique || 0);

                return (
                  <div className="table-row" key={r.id}>
                    <div className="td name">
                      <div className="main">{s(r.name) || "Untitled"}</div>
                      <div className="sub">{r.created_at ? fmtDate(r.created_at) : ""}</div>
                    </div>

                    <div className="td subject">
                      <div className="main">{s(r.subject) || "—"}</div>
                    </div>

                    <div className="td timing">
                      <div className="main">{s(r.trigger_type) || "—"}</div>
                      <div className="sub">
                        {s(r.send_day) || "—"} • {s(r.send_time) || "—"}
                      </div>
                    </div>

                    <div className="td list">
                      <div className="main">{s(r.list_name) || "—"}</div>
                    </div>

                    <div className="td days">
                      <div className="main">
                        {Array.isArray(r.active_days) && r.active_days.length
                          ? r.active_days.join(", ")
                          : "Every day"}
                      </div>
                    </div>

                    <div className="td stats">
                      <div className="stats-grid">
                        <div className="pill">
                          <span className="k">Queued</span>
                          <span className="v">{queued}</span>
                        </div>
                        <div className="pill">
                          <span className="k">Pending</span>
                          <span className="v">{pending}</span>
                        </div>
                        <div className="pill">
                          <span className="k">Sent</span>
                          <span className="v">{sent}</span>
                        </div>
                        <div className="pill">
                          <span className="k">Failed</span>
                          <span className="v">{failed}</span>
                        </div>

                        <div className="meta">
                          <div>
                            <span className="meta-k">Last sent:</span>{" "}
                            <span className="meta-v">{lastSent}</span>
                          </div>
                          <div>
                            <span className="meta-k">Opens:</span>{" "}
                            <span className="meta-v">
                              {opensTotal}
                              {opensUnique ? ` (${opensUnique} unique)` : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="td actions">
                      <button
                        className="btn blue"
                        onClick={() => {
                          const qp = new URLSearchParams();
                          qp.set("autoresponder_id", String(r.id));
                          router.push(`/modules/email/editor?${qp.toString()}`);
                        }}
                      >
                        Edit emails
                      </button>

                      <button
                        className="btn dark"
                        onClick={() => {
                          const qp = new URLSearchParams();
                          qp.set("autoresponder_id", String(r.id));
                          router.push(`/modules/email/autoresponders?${qp.toString()}`);
                        }}
                      >
                        Edit details
                      </button>

                      <button className="btn red" onClick={() => deleteAutoresponder(r.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {!!msg && (
            <div className="msg" style={{ whiteSpace: "pre-wrap" }}>
              {msg}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        /* MIN FONT SIZE ACROSS WHOLE PAGE */
        :global(html),
        :global(body),
        :global(*) {
          font-size: 16px;
        }

        .banner-wrapper {
          display: flex;
          justify-content: center;
          width: 100%;
        }

        /* Banner EXACT AS-IS (do not touch sizes/colors/layout) */
        .banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #a855f7;
          width: 1320px;
          border-radius: 12px;
          padding: 20px 28px;
          color: #fff;
          margin-top: 20px;
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .icon {
          font-size: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .title {
          margin: 0;
          font-size: 36px;
        }
        .subtitle {
          margin: 2px 0 0;
          opacity: 0.9;
          font-size: 22px;
        }
        .banner-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .back {
          background: #111821;
          color: #e5e7eb;
          border: 1px solid #4b5563;
          padding: 10px 18px;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 500;
          font-size: 20px;
        }
        .new {
          background: #10b981;
          color: #fff;
          border: none;
          padding: 10px 18px;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 700;
          font-size: 18px;
        }

        /* Page + table centered under banner */
        .page-wrap {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        /* ✅ Make content width 1400 and centered under banner */
        .table-wrap {
          width: 1400px;
          margin-top: 18px;
          margin-bottom: 140px;
        }

        .table-card {
          background: #0c121a;
          border: 1px solid #333;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        }

        .table-head {
          display: grid;
          grid-template-columns: 1.2fr 1.2fr 1.4fr 1.2fr 1fr 1.8fr 1fr;
          gap: 0px;
          padding: 14px 18px;
          background: #0b1118;
          border-bottom: 1px solid #222;
          color: #cbd5e1;
          font-weight: 700;
          letter-spacing: 0.2px;
        }

        .th {
          font-size: 16px;
        }

        .table-row {
          display: grid;
          grid-template-columns: 1.2fr 1.2fr 1.4fr 1.2fr 1fr 1.8fr 1fr;
          padding: 16px 18px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          align-items: center;
        }

        .table-row:last-child {
          border-bottom: none;
        }

        .td .main {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
          line-height: 1.25;
        }

        .td .sub {
          font-size: 16px;
          color: #9ca3af;
          margin-top: 4px;
          line-height: 1.25;
        }

        .loading,
        .empty {
          padding: 26px 18px;
          color: #e5e7eb;
          font-size: 16px;
        }

        /* Stats layout */
        .stats-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .pill {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          background: #111821;
          border: 1px solid #2b3647;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 16px;
        }
        .pill .k {
          color: #cbd5e1;
          font-weight: 700;
          font-size: 16px;
        }
        .pill .v {
          color: #ffffff;
          font-weight: 900;
          font-size: 16px;
        }

        .meta {
          font-size: 16px;
          color: #cbd5e1;
          line-height: 1.3;
        }
        .meta-k {
          color: #9ca3af;
          font-weight: 700;
          font-size: 16px;
        }
        .meta-v {
          color: #e5e7eb;
          font-weight: 700;
          font-size: 16px;
        }

        /* Actions */
        .actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: stretch;
        }
        .btn {
          width: 100%;
          border: none;
          border-radius: 6px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 800;
          font-size: 16px;
        }
        .btn.blue {
          background: #2563eb;
          color: #fff;
        }
        .btn.dark {
          background: #111821;
          border: 1px solid #4b5563;
          color: #e5e7eb;
        }
        .btn.red {
          background: #dc2626;
          color: #fff;
        }

        .msg {
          margin-top: 12px;
          background: #0c121a;
          border: 1px solid #333;
          border-radius: 12px;
          padding: 12px 14px;
          color: #10b981;
          font-size: 16px;
        }

        @media (max-width: 1500px) {
          .table-wrap {
            width: 96%;
          }
        }
      `}</style>
    </>
  );
}
