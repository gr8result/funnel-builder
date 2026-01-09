// /pages/sites/[...slug].js
// FULL REPLACEMENT — Render /sites/<slug> from Supabase ONLY (no external builders)
// ✅ Reads: website_pages.content_json.sections (version 2)
// ✅ Full-bleed sections with constrained 1440px content
// ✅ Responsive by default (stacks columns on small screens)

import Head from "next/head";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CONTENT_WIDTH = 1440;

function FullBleed({ bg, children }) {
  return (
    <div style={{ width: "100%", background: bg || "transparent" }}>
      <div style={{ maxWidth: CONTENT_WIDTH, margin: "0 auto", padding: "56px 18px" }}>{children}</div>
    </div>
  );
}

function Section({ s }) {
  if (!s) return null;
  const d = s.data || {};

  if (s.type === "header") {
    const links = Array.isArray(d.links) ? d.links : [];
    return (
      <div style={{ width: "100%", background: "#0b1220" }}>
        <div style={{ maxWidth: CONTENT_WIDTH, margin: "0 auto", padding: "18px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ fontSize: 22, fontWeight: 950, color: "#fff" }}>{d.brand || "Your Brand"}</div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {links.map((t, i) => (
                <a key={i} href="#" onClick={(e) => e.preventDefault()} style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontWeight: 850, fontSize: 14 }}>
                  {t}
                </a>
              ))}
              <a href="#" onClick={(e) => e.preventDefault()} style={{ padding: "10px 14px", borderRadius: 12, background: "#2297c5", color: "#06121d", fontWeight: 950, textDecoration: "none" }}>
                {d.cta || "Get Started"}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (s.type === "hero") {
    return (
      <FullBleed bg="linear-gradient(135deg, rgba(34,151,197,0.18), rgba(2,6,23,0.0))">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
          <div style={{ fontSize: 56, fontWeight: 980, color: "#0b1220", letterSpacing: -0.6 }}>{d.headline || "Headline"}</div>
          <div style={{ fontSize: 18, lineHeight: 1.6, color: "rgba(11,18,32,0.82)", fontWeight: 650 }}>{d.sub || ""}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href={d.primaryHref || "#"} style={{ padding: "14px 18px", borderRadius: 14, background: "#2297c5", color: "#06121d", textDecoration: "none", fontWeight: 980 }}>
              {d.primaryLabel || "Get Started"}
            </a>
            <a href={d.secondaryHref || "#"} style={{ padding: "14px 18px", borderRadius: 14, background: "rgba(2,6,23,0.06)", border: "1px solid rgba(2,6,23,0.12)", color: "#0b1220", textDecoration: "none", fontWeight: 950 }}>
              {d.secondaryLabel || "Learn More"}
            </a>
          </div>
        </div>
      </FullBleed>
    );
  }

  if (s.type === "heroSplit") {
    return (
      <FullBleed bg="#fff">
        <div className="gr8-row">
          <div>
            <div style={{ fontSize: 54, fontWeight: 990, color: "#0b1220", letterSpacing: -0.6 }}>{d.headline || "Headline"}</div>
            <div style={{ height: 12 }} />
            <div style={{ fontSize: 18, lineHeight: 1.6, color: "rgba(11,18,32,0.82)", fontWeight: 650 }}>{d.sub || ""}</div>
            <div style={{ height: 16 }} />
            <a href={d.primaryHref || "#"} style={{ display: "inline-flex", padding: "14px 18px", borderRadius: 14, background: "#2297c5", color: "#06121d", textDecoration: "none", fontWeight: 980 }}>
              {d.primaryLabel || "Start"}
            </a>
          </div>

          <div style={{ borderRadius: 22, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(2,6,23,0.03)", overflow: "hidden", minHeight: 380 }}>
            {d.imageUrl ? (
              <img src={d.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, color: "rgba(11,18,32,0.55)" }}>
                Image
              </div>
            )}
          </div>
        </div>
      </FullBleed>
    );
  }

  if (s.type === "features3") {
    const items = Array.isArray(d.items) ? d.items : [];
    return (
      <FullBleed bg="#fff">
        <div style={{ fontSize: 34, fontWeight: 990, color: "#0b1220", letterSpacing: -0.4 }}>{d.title || "Title"}</div>
        <div style={{ height: 18 }} />
        <div className="gr8-grid3">
          {items.slice(0, 3).map((it, idx) => (
            <div key={idx} style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(2,6,23,0.02)", padding: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 980, color: "#0b1220" }}>{it.title || "Feature"}</div>
              <div style={{ height: 8 }} />
              <div style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(11,18,32,0.78)", fontWeight: 650 }}>{it.text || ""}</div>
            </div>
          ))}
        </div>
      </FullBleed>
    );
  }

  if (s.type === "content2") {
    return (
      <FullBleed bg="#fff">
        <div className="gr8-row">
          <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.18)", padding: 18, background: "rgba(2,6,23,0.02)" }}>
            <div style={{ fontSize: 22, fontWeight: 990, color: "#0b1220" }}>{d.leftTitle || "Left"}</div>
            <div style={{ height: 10 }} />
            <div style={{ fontSize: 15, lineHeight: 1.7, color: "rgba(11,18,32,0.78)", fontWeight: 650 }}>{d.leftText || ""}</div>
          </div>
          <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.18)", padding: 18, background: "rgba(2,6,23,0.02)" }}>
            <div style={{ fontSize: 22, fontWeight: 990, color: "#0b1220" }}>{d.rightTitle || "Right"}</div>
            <div style={{ height: 10 }} />
            <div style={{ fontSize: 15, lineHeight: 1.7, color: "rgba(11,18,32,0.78)", fontWeight: 650 }}>{d.rightText || ""}</div>
          </div>
        </div>
      </FullBleed>
    );
  }

  if (s.type === "ctaBand") {
    return (
      <FullBleed bg="#0b1220">
        <div className="gr8-row">
          <div>
            <div style={{ fontSize: 38, fontWeight: 990, color: "#fff", letterSpacing: -0.4 }}>{d.headline || "CTA"}</div>
            <div style={{ height: 10 }} />
            <div style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(255,255,255,0.80)", fontWeight: 750 }}>{d.sub || ""}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <a href={d.href || "#"} style={{ padding: "14px 18px", borderRadius: 14, background: "#2297c5", color: "#06121d", textDecoration: "none", fontWeight: 980 }}>
              {d.button || "Action"}
            </a>
          </div>
        </div>
      </FullBleed>
    );
  }

  if (s.type === "optinForm") {
    return (
      <FullBleed bg="#fff">
        <div className="gr8-row">
          <div>
            <div style={{ fontSize: 32, fontWeight: 990, color: "#0b1220", letterSpacing: -0.4 }}>{d.title || "Opt-in"}</div>
            <div style={{ height: 10 }} />
            <div style={{ fontSize: 16, lineHeight: 1.7, color: "rgba(11,18,32,0.75)", fontWeight: 650 }}>{d.sub || ""}</div>
          </div>
          <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.18)", padding: 18, background: "rgba(2,6,23,0.02)" }}>
            <input placeholder="you@company.com" style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(148,163,184,0.30)" }} />
            <div style={{ height: 10 }} />
            <button type="button" style={{ width: "100%", padding: 12, borderRadius: 12, border: "none", background: "#2297c5", color: "#06121d", fontWeight: 950 }}>
              {d.button || "Submit"}
            </button>
          </div>
        </div>
      </FullBleed>
    );
  }

  if (s.type === "contactForm") {
    return (
      <FullBleed bg="#fff">
        <div style={{ fontSize: 32, fontWeight: 990, color: "#0b1220", letterSpacing: -0.4 }}>{d.title || "Contact"}</div>
        <div style={{ height: 10 }} />
        <div style={{ fontSize: 16, lineHeight: 1.7, color: "rgba(11,18,32,0.75)", fontWeight: 650 }}>{d.sub || ""}</div>
        <div style={{ height: 16 }} />
        <div style={{ borderRadius: 18, border: "1px solid rgba(148,163,184,0.18)", padding: 18, background: "rgba(2,6,23,0.02)" }}>
          <div className="gr8-row">
            <input placeholder="Name" style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(148,163,184,0.30)" }} />
            <input placeholder="Email" style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(148,163,184,0.30)" }} />
          </div>
          <div style={{ height: 12 }} />
          <textarea placeholder="Message" style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(148,163,184,0.30)", minHeight: 110 }} />
          <div style={{ height: 12 }} />
          <button type="button" style={{ width: "100%", padding: 12, borderRadius: 12, border: "none", background: "#2297c5", color: "#06121d", fontWeight: 950 }}>
            {d.button || "Send"}
          </button>
        </div>
      </FullBleed>
    );
  }

  if (s.type === "testimonials") {
    const items = Array.isArray(d.items) ? d.items : [];
    return (
      <FullBleed bg="rgba(2,6,23,0.02)">
        <div style={{ fontSize: 32, fontWeight: 990, color: "#0b1220", letterSpacing: -0.4 }}>{d.title || "Testimonials"}</div>
        <div style={{ height: 18 }} />
        <div className="gr8-grid3">
          {items.slice(0, 3).map((it, idx) => (
            <div key={idx} style={{ borderRadius: 18, background: "#fff", border: "1px solid rgba(148,163,184,0.18)", padding: 18 }}>
              <div style={{ fontSize: 15, lineHeight: 1.7, color: "rgba(11,18,32,0.80)", fontWeight: 650 }}>{it.quote || ""}</div>
              <div style={{ height: 12 }} />
              <div style={{ fontSize: 13, fontWeight: 980, color: "#0b1220" }}>{it.name || ""}</div>
            </div>
          ))}
        </div>
      </FullBleed>
    );
  }

  if (s.type === "faq") {
    const items = Array.isArray(d.items) ? d.items : [];
    return (
      <FullBleed bg="#fff">
        <div style={{ fontSize: 32, fontWeight: 990, color: "#0b1220", letterSpacing: -0.4 }}>{d.title || "FAQ"}</div>
        <div style={{ height: 14 }} />
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((it, idx) => (
            <details key={idx} style={{ borderRadius: 16, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(2,6,23,0.02)", padding: "10px 12px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 980, color: "#0b1220" }}>{it.q || "Question"}</summary>
              <div style={{ padding: "10px 2px 4px", color: "rgba(11,18,32,0.78)", fontWeight: 650, lineHeight: 1.7 }}>{it.a || ""}</div>
            </details>
          ))}
        </div>
      </FullBleed>
    );
  }

  if (s.type === "footer") {
    const links = Array.isArray(d.links) ? d.links : [];
    return (
      <div style={{ width: "100%", background: "#0b1220" }}>
        <div style={{ maxWidth: CONTENT_WIDTH, margin: "0 auto", padding: "28px 18px" }}>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 990, color: "#fff" }}>{d.brand || "Your Brand"}</div>
              <div style={{ height: 10 }} />
              <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(255,255,255,0.70)" }}>{d.note || ""}</div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {links.map((t, i) => (
                <a key={i} href="#" onClick={(e) => e.preventDefault()} style={{ color: "rgba(255,255,255,0.82)", textDecoration: "none", fontWeight: 900, fontSize: 13 }}>
                  {t}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export async function getServerSideProps(ctx) {
  const slugArr = ctx.params?.slug || [];
  const slug = slugArr.join("/").replace(/^\/+/, "");

  const { data, error } = await supabase
    .from("website_pages")
    .select("title, slug, content_json")
    .eq("slug", slug)
    .limit(1);

  if (error) return { notFound: true };
  const row = data?.[0] || null;
  if (!row) return { notFound: true };

  const sections = row?.content_json?.sections || [];
  return {
    props: {
      title: row.title || slug,
      sections: Array.isArray(sections) ? sections : [],
    },
  };
}

export default function SitePage({ title, sections }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Responsive helpers */}
      <style>{`
        .gr8-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          align-items: stretch;
        }
        .gr8-grid3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }
        @media (max-width: 980px) {
          .gr8-row { grid-template-columns: 1fr; }
          .gr8-grid3 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Arial", background: "#fff" }}>
        {(sections || []).map((s) => (
          <Section key={s.id || Math.random()} s={s} />
        ))}
      </div>
    </>
  );
}
