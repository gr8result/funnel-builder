import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../utils/supabase-client";
import ICONS from "../../../../components/iconMap";

export default function VendorConsole() {
  const [loading, setLoading] = useState(true);
  const [vendor, setVendor] = useState(null);
  const [courses, setCourses] = useState([]);
  const [showAgreement, setShowAgreement] = useState(false);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [savingAgreement, setSavingAgreement] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const { data: v } = await supabase
      .from("course_vendors")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    setVendor(v || null);

    if (v?.id) {
      const { data: c } = await supabase
        .from("courses")
        .select("*")
        .eq("vendor_id", v.id)
        .order("created_at", { ascending: false });

      setCourses(c || []);
    }

    setLoading(false);
  }

  async function acceptAgreement() {
    if (!vendor?.id || !agreeChecked) return;

    setSavingAgreement(true);

    const { error } = await supabase
      .from("course_vendors")
      .update({
        marketplace_terms_accepted: true,
        marketplace_terms_accepted_at: new Date().toISOString(),
      })
      .eq("id", vendor.id);

    setSavingAgreement(false);

    if (error) {
      alert(error.message);
      return;
    }

    setShowAgreement(false);
    load();
  }

  async function deleteCourse(courseId) {
    if (!confirm("Delete this course permanently?")) return;

    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", courseId);

    if (error) {
      alert(error.message);
      return;
    }

    load();
  }

  const agreementAccepted = vendor?.marketplace_terms_accepted === true;

  return (
    <div style={page.wrap}>
      <div style={page.inner}>
        {/* Banner */}
        <div style={page.banner}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={page.iconWrap}>
              {ICONS.courses({ size: 28, color: "#fff" })}
            </div>
            <div>
              <h1 style={page.title}>Vendor Console</h1>
              <p style={page.subtitle}>Create and manage your courses</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/modules/courses">
              <button style={page.backBtn}>← Marketplace</button>
            </Link>
            <Link href="/dashboard">
              <button style={page.backBtn}>← Dashboard</button>
            </Link>
          </div>
        </div>

        {/* Agreement Gate */}
        {!agreementAccepted && (
          <div style={page.warning}>
            Marketplace Agreement: <b>Not accepted</b>
            <button
              style={page.primaryBtn}
              onClick={() => setShowAgreement(true)}
            >
              Review & Accept
            </button>
          </div>
        )}

        {/* Courses */}
        <div style={page.panel}>
          <div style={page.panelHeader}>
            <h2>Your Courses</h2>
            <button
              style={page.primaryBtn}
              disabled={!agreementAccepted}
              onClick={() => location.href = "/modules/courses/create"}
            >
              + Create Course
            </button>
          </div>

          {courses.map((c) => (
            <div key={c.id} style={page.courseRow}>
              <div>
                <b>{c.title}</b>
                <div style={{ opacity: 0.7 }}>
                  {c.is_published ? "Published" : "Draft"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/modules/courses/${c.id}/edit`}>
                  <button style={page.secondaryBtn}>Edit</button>
                </Link>
                <Link href={`/modules/courses/${c.id}/pricing`}>
                  <button style={page.secondaryBtn}>Pricing</button>
                </Link>
                <Link href={`/modules/courses/${c.id}/learn`}>
                  <button style={page.secondaryBtn}>Preview</button>
                </Link>
                <button
                  style={page.deleteBtn}
                  onClick={() => deleteCourse(c.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agreement Modal */}
      {showAgreement && (
        <div style={modal.backdrop}>
          <div style={modal.box}>
            <h2>Marketplace Vendor Agreement</h2>

            <div style={{ fontSize: 16, lineHeight: 1.55, marginTop: 12 }}>
              By selling courses on this platform, you agree that:
              <ul>
                <li>The platform retains <b>30%</b> of each transaction.</li>
                <li>Payouts are processed via Stripe / PayPal.</li>
                <li>You are responsible for your course content.</li>
              </ul>
            </div>

            <label style={modal.checkRow}>
              <input
                type="checkbox"
                checked={agreeChecked}
                onChange={(e) => setAgreeChecked(e.target.checked)}
                style={{ width: 26, height: 26 }}
              />
              <span>I accept the Marketplace Vendor Agreement</span>
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                style={page.secondaryBtn}
                onClick={() => setShowAgreement(false)}
              >
                Cancel
              </button>
              <button
                style={page.primaryBtn}
                disabled={!agreeChecked || savingAgreement}
                onClick={acceptAgreement}
              >
                {savingAgreement ? "Saving…" : "Accept"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const page = {
  wrap: { minHeight: "100vh", background: "#0c121a", color: "#fff", padding: 24 },
  inner: { maxWidth: 1320, margin: "0 auto" },

  banner: {
    background: "#ec4899",
    padding: 18,
    borderRadius: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },

  iconWrap: { background: "rgba(255,255,255,.2)", padding: 10, borderRadius: "50%" },
  title: { margin: 0 },
  subtitle: { margin: 0, opacity: 0.9 },

  backBtn: {
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #334155",
    padding: "10px 16px",
    borderRadius: 8,
    fontWeight: 700,
  },

  warning: {
    background: "#7c2d12",
    padding: 14,
    borderRadius: 10,
    marginBottom: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  panel: { background: "#111827", borderRadius: 12, padding: 14 },
  panelHeader: { display: "flex", justifyContent: "space-between", marginBottom: 12 },

  courseRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: 12,
    borderBottom: "1px solid #1f2937",
  },

  primaryBtn: {
    background: "#facc15",
    border: "none",
    padding: "10px 14px",
    borderRadius: 8,
    fontWeight: 900,
  },

  secondaryBtn: {
    background: "#1e293b",
    border: "1px solid #334155",
    padding: "10px 14px",
    borderRadius: 8,
    color: "#fff",
  },

  deleteBtn: {
    background: "#7f1d1d",
    border: "none",
    padding: "10px 14px",
    borderRadius: 8,
    color: "#fff",
  },
};

const modal = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    background: "#0b1220",
    padding: 20,
    borderRadius: 12,
    maxWidth: 520,
    width: "100%",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    fontSize: 16,
  },
};
