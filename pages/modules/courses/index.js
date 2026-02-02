// /pages/modules/courses/index.js
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ICONS from "../../../components/iconMap";
import { supabase } from "../../../utils/supabase-client";

export default function CoursesIndex() {
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState([]);
  const [search, setSearch] = useState("");

  const [userId, setUserId] = useState(null);
  const [vendor, setVendor] = useState(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      if (!alive) return;

      setUserId(uid);

      if (uid) {
        const { data: v, error: vErr } = await supabase
          .from("course_vendors")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();

        if (vErr) console.error(vErr);
        if (!alive) return;
        setVendor(v || null);
      } else {
        setVendor(null);
      }

      const { data: cs, error: cErr } = await supabase
        .from("courses")
        .select("id,title,description,cover_url,is_published,created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });

      if (cErr) console.error("Load courses error:", cErr);
      if (!alive) return;

      setCourses(cs || []);
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return courses;
    return (courses || []).filter((c) => {
      const hay = `${c.title || ""} ${c.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [courses, search]);

  return (
    <div style={page.wrap}>
      <div style={page.inner}>
        {/* Banner (kept same style as your current module pattern) */}
        <div style={page.banner}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={page.iconWrap}>{ICONS.courses({ size: 48, color: "#fff" })}</div>
            <div>
              <h1 style={page.title}>Online Courses</h1>
              <p style={page.subtitle}>
                Curriculum builder, lessons, enrollments & progress tracking.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {vendor?.id ? (
              <Link href="/modules/courses/vendor">
                <button style={page.vendorBtn}>Vendor Console →</button>
              </Link>
            ) : (
              <button style={{ ...page.vendorBtn, opacity: 0.6 }} disabled title="Vendor profile required">
                Vendor Console →
              </button>
            )}

            <Link href="/dashboard">
              <button style={page.backBtn}>← Back</button>
            </Link>
          </div>
        </div>

        {/* Marketplace */}
        <div style={page.grid}>
          {/* Left panel */}
          <div style={page.panel}>
            <div style={page.panelTitle}>Find a course</div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search courses…"
              style={page.searchInput}
            />

            <div style={page.metaText}>
              {loading ? "Loading courses…" : `${filtered.length} course(s) found`}
            </div>

            <div style={page.hr} />

            <div style={page.panelTitle}>Quick links</div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <Link href="/modules/courses/vendor">
                <button style={page.actionBtn}>Vendor Console →</button>
              </Link>

              <Link href="/modules/courses">
                <button style={page.actionBtnAlt}>Marketplace (refresh)</button>
              </Link>
            </div>

            <div style={{ marginTop: 12, opacity: 0.75, fontSize: 16 }}>
              Debug marker: <b>COURSES-INDEX-LIVE-v1</b>
            </div>
          </div>

          {/* Right panel */}
          <div style={page.panel}>
            <div style={page.panelTitle}>Marketplace</div>

            {loading ? (
              <div style={page.emptyState}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={page.emptyState}>
                No published courses found yet.
                <div style={{ marginTop: 8, opacity: 0.8 }}>
                  Publish a course in the vendor editor, then refresh this page.
                </div>
              </div>
            ) : (
              <div style={page.cardsGrid}>
                {filtered.map((c) => (
                  <div key={c.id} style={page.card}>
                    <div
                      style={{
                        ...page.cardCover,
                        background: c.cover_url
                          ? `url(${c.cover_url}) center/cover no-repeat`
                          : "linear-gradient(135deg, rgba(236,72,153,0.25), rgba(255,255,255,0.06))",
                      }}
                    />
                    <div style={page.cardBody}>
                      <div style={page.cardTitle}>{c.title || "Untitled Course"}</div>
                      <div style={page.cardDesc}>
                        {c.description ? c.description.slice(0, 150) : "No description yet."}
                        {c.description && c.description.length > 150 ? "…" : ""}
                      </div>

                      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                        <Link href={`/modules/courses/${c.id}/learn`}>
                          <button style={page.primaryBtn}>View →</button>
                        </Link>

                        <Link href={`/modules/courses/${c.id}/learn`}>
                          <button style={page.secondaryBtn}>Start →</button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const page = {
  wrap: {
    minHeight: "100vh",
    background: "#0c121a",
    color: "#fff",
    padding: "28px 22px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  },
  inner: { width: "100%", maxWidth: 1320, margin: "0 auto" },

  // Banner (matches your earlier module look)
  banner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#ec4899",
    borderRadius: 12,
    padding: "18px 22px",
    marginBottom: 26,
    fontWeight: 600,
    gap: 14,
  },
  iconWrap: {
    background: "rgba(255,255,255,0.18)",
    borderRadius: "50%",
    padding: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 48, fontWeight: 600, margin: 0 },
  subtitle: { fontSize: 18, fontWeight: 600,opacity: 0.9, margin: 0, marginTop: 4 },

  backBtn: {
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
  },
  vendorBtn: {
    background: "rgba(255,255,255,0.18)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.28)",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "360px 1fr",
    gap: 14,
    alignItems: "start",
  },

  panel: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 12,
    padding: 14,
  },
  panelTitle: { fontSize: 28, fontWeight: 600, marginBottom: 10 },

  searchInput: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 10,
    border: "1px solid #334155",
    fontSize: 16,
    outline: "none",
    background: "#0b1220",
    color: "#fff",
  },

  metaText: { marginTop: 10, opacity: 0.85, fontSize: 16 },
  hr: { borderTop: "1px solid #1f2937", margin: "14px 0" },

  actionBtn: {
    width: "100%",
    background: "#ec4899",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: "12px 12px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  actionBtnAlt: {
    width: "100%",
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: "12px 12px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },

  emptyState: { padding: 12, opacity: 0.9 },

  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
  },
  card: {
    background: "#0b1220",
    border: "1px solid #1f2937",
    borderRadius: 14,
    overflow: "hidden",
    display: "grid",
    gridTemplateRows: "170px 1fr",
  },
  cardCover: { width: "100%" },
  cardBody: { padding: 12 },
  cardTitle: { fontSize: 16, fontWeight: 900, marginBottom: 6 },
  cardDesc: { fontSize: 14, opacity: 0.8, lineHeight: 1.35, minHeight: 40 },

  primaryBtn: {
    background: "#ec4899",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  secondaryBtn: {
    background: "#1e293b",
    border: "1px solid #334155",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  comingSoonBox: {
    background: "#111827",
    border: "1px solid #ec4899",
    borderRadius: 12,
    padding: 24,
    textAlign: "center",
    marginTop: 18,
  },
};
