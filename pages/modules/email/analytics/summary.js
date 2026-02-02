import { useEffect, useState } from "react";
import Head from "next/head";
import { createClient } from "@supabase/supabase-js";

export default function EmailAnalyticsSummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // ✅ Supabase client created ONLY in browser
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );

      const { data, error } = await supabase
        .from("email_analytics_summary")
        .select("*")
        .single();

      if (!error) setData(data);
      setLoading(false);
    }

    load();
  }, []);

  return (
    <>
      <Head>
        <title>Email Analytics Summary</title>
      </Head>

      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>
          Email Analytics Summary
        </h1>

        {loading && <p>Loading…</p>}

        {!loading && !data && (
          <p style={{ opacity: 0.7 }}>No analytics data found.</p>
        )}

        {!loading && data && (
          <pre
            style={{
              marginTop: 20,
              padding: 16,
              background: "#f8fafc",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}
