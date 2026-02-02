// /pages/modules/email/reports/crm-sms.js
// CRM & SMS analytics report — reads from sms_sends and email_sends

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../utils/supabase-client";
import ReportBanner from "../../../../components/ui/ReportBanner";

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

export default function CrmSmsReport() {
  const [range, setRange] = useState("all");
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [smsRows, setSmsRows] = useState([]);

  const fromIso = useMemo(() => isoDaysAgo(RANGE_TO_DAYS[range]), [range]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setLoadErr(null);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        setUserId(uid);
        if (!uid) {
          setSmsRows([]);
          setLoading(false);
          return;
        }
        let q = supabase
          .from("sms_sends")
          .select("id, user_id, phone, message, delivery_status, delivered_at, failed_at, reply_count, last_event, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (fromIso) q = q.gte("created_at", fromIso);
        const { data, error } = await q;
        if (error) throw error;
        setSmsRows(data || []);
        setLoading(false);
      } catch (e) {
        setLoadErr(String(e?.message || e));
        setLoading(false);
      }
    }
    run();
    return () => (mounted = false);
  }, [fromIso]);

  return (
    <div>
      <Head>
        <title>CRM & SMS Analytics</title>
      </Head>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24, padding: '0 12px' }}>
        <div style={{ width: 1320, maxWidth: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#06b6d4', borderRadius: 18, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>💬</div>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#164e63', margin: 0 }}>CRM & SMS</div>
              <div style={{ fontSize: 16, color: '#164e63', opacity: 0.9, margin: '4px 0 0 0' }}>Analytics for contacts, calls, SMS delivery, and activity.</div>
            </div>
          </div>
          <a href="/modules/email/reports" style={{ background: 'rgba(0,0,0,0.1)', color: '#164e63', padding: '8px 16px', borderRadius: 999, textDecoration: 'none', fontWeight: 500, border: '1px solid rgba(0,0,0,0.2)' }}>← Back</a>
        </div>
      </div>
      {loading ? <div style={{ padding: '20px', textAlign: 'center', color: '#fff' }}>Loading...</div> : null}
      {loadErr ? <div style={{ padding: '20px', textAlign: 'center', color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 8, margin: '20px' }}>Error: {loadErr}</div> : null}
      <div>
        <h2>SMS Sends</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Phone</th>
              <th>Message</th>
              <th>Status</th>
              <th>Replies</th>
            </tr>
          </thead>
          <tbody>
            {smsRows.map((row) => (
              <tr key={row.id}>
                <td>{row.created_at}</td>
                <td>{row.phone}</td>
                <td>{row.message}</td>
                <td>{row.delivery_status}</td>
                <td>{row.reply_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
