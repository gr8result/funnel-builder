import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../../utils/supabase-client";
import styles from "../../../../styles/email-crm.module.css";

const baseBlue = "#2297c5";

export default function CourseLearnPage() {
  const router = useRouter();
  const { courseId } = router.query;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [userId, setUserId] = useState(null);
  const [course, setCourse] = useState(null);
  const [modules, setModules] = useState([]);
  const [lessonsByModule, setLessonsByModule] = useState({});
  const [entitlements, setEntitlements] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);

  const hasFullAccess = useMemo(
    () => entitlements.some((e) => e.entitlement_type === "full_course"),
    [entitlements]
  );

  const unlockedModuleIds = useMemo(() => {
    if (hasFullAccess) return new Set(modules.map((m) => m.id));
    const set = new Set();
    entitlements
      .filter((e) => e.entitlement_type === "module" && e.module_id)
      .forEach((e) => set.add(e.module_id));
    return set;
  }, [entitlements, hasFullAccess, modules]);

  function isModuleUnlocked(moduleId) {
    if (hasFullAccess) return true;
    return unlockedModuleIds.has(moduleId);
  }

  function findFirstUnlockedLesson(mods, lessonsMap, ents) {
    const full = (ents || []).some((e) => e.entitlement_type === "full_course");
    const unlocked = new Set();
    if (!full) {
      (ents || [])
        .filter((e) => e.entitlement_type === "module" && e.module_id)
        .forEach((e) => unlocked.add(e.module_id));
    }

    for (const m of mods) {
      const ok = full || unlocked.has(m.id);
      if (!ok) continue;
      const lessons = lessonsMap[m.id] || [];
      if (lessons.length) return lessons[0];
    }
    return null;
  }

  // ✅ Stripe return handler MUST be at top-level (NOT inside load)
  useEffect(() => {
    if (!router.isReady) return;
    if (!courseId) return;

    if (router.query?.success === "1") {
      // shallow replace to clear query params
      router.replace(`/modules/courses/${courseId}/learn`, undefined, { shallow: true });
    }
  }, [router.isReady, router.query?.success, courseId]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!courseId) return;
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || null;
      if (!alive) return;
      setUserId(uid);

      const { data: courseData, error: courseErr } = await supabase
        .from("courses")
        .select("*")
        .eq("id", courseId)
        .single();

      if (courseErr) {
        console.error(courseErr);
        if (!alive) return;
        setCourse(null);
        setModules([]);
        setLessonsByModule({});
        setEntitlements([]);
        setActiveLesson(null);
        setLoading(false);
        return;
      }

      const { data: moduleData, error: modErr } = await supabase
        .from("course_modules")
        .select("*")
        .eq("course_id", courseId)
        .order("sort_order", { ascending: true });

      if (modErr) console.error(modErr);

      const moduleIds = (moduleData || []).map((m) => m.id);

      let lessonsMap = {};
      if (moduleIds.length) {
        const { data: lessonsData, error: lessonErr } = await supabase
          .from("course_lessons")
          .select("*")
          .in("module_id", moduleIds)
          .order("sort_order", { ascending: true });

        if (lessonErr) console.error(lessonErr);

        lessonsMap = (lessonsData || []).reduce((acc, lesson) => {
          acc[lesson.module_id] = acc[lesson.module_id] || [];
          acc[lesson.module_id].push(lesson);
          return acc;
        }, {});
      }

      let entData = [];
      if (uid) {
        const { data: ent, error: entErr } = await supabase
          .from("course_entitlements")
          .select("*")
          .eq("course_id", courseId)
          .eq("user_id", uid);

        if (entErr) console.error(entErr);
        entData = ent || [];
      }

      if (!alive) return;

      setCourse(courseData);
      setModules(moduleData || []);
      setLessonsByModule(lessonsMap);
      setEntitlements(entData);

      setActiveLesson(findFirstUnlockedLesson(moduleData || [], lessonsMap, entData));
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [courseId]);

  async function startCheckout({ scope, moduleId }) {
    try {
      setBusy(true);

      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      if (!token) {
        alert("Please log in first.");
        return;
      }

      const res = await fetch("/api/courses/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ courseId, scope, moduleId }),
      });

      const json = await res.json();
      if (!res.ok) {
        alert(json?.error || "Checkout failed");
        return;
      }

      if (json?.url) window.location.href = json.url;
      else alert("No checkout URL returned.");
    } finally {
      setBusy(false);
    }
  }

  // ✅ When user clicks locked module/lesson: ALWAYS go to payment
  function onLockedModuleClick(moduleId) {
    if (!userId) {
      alert("Please log in first.");
      return;
    }
    startCheckout({ scope: "module", moduleId });
  }

  if (loading) {
    return (
      <div className={styles.pageWrap} style={{ fontSize: 16 }}>
        <div style={{ padding: 18 }}>Loading course…</div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className={styles.pageWrap}>
        <div style={{ padding: 18 }}>Course not found.</div>
      </div>
    );
  }

  return (
    <div className={styles.pageWrap}>
      {/* Banner */}
      <div
        style={{
          width: "1320px",
          maxWidth: "100%",
          margin: "0 auto",
          background: baseBlue,
          color: "#fff",
          borderRadius: 14,
          padding: "18px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 48, fontWeight: 500, lineHeight: 1.1 }}>
            {course.title || "Course"}
          </div>

          <div style={{ fontSize: 18, opacity: 0.95, marginTop: 6 }}>
            {hasFullAccess
              ? "Access: Full course unlocked"
              : userId
              ? "Access: Module-by-module unlock"
              : "Login required to purchase/unlock"}
          </div>

          {!!course.description && (
            <div style={{ fontSize: 16, opacity: 0.92, marginTop: 6, maxWidth: 820 }}>
              {course.description}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* ✅ CHANGE: Dashboard button becomes Marketplace */}
          <Link
            href="/modules/courses"
            style={{
              background: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.28)",
              color: "#fff",
              padding: "10px 14px",
              borderRadius: 10,
              textDecoration: "none",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            ← Marketplace
          </Link>

          {!hasFullAccess && (
            <button
              onClick={() => startCheckout({ scope: "full_course" })}
              disabled={!userId || busy}
              style={{
                background: "#fff",
                color: baseBlue,
                border: "none",
                padding: "10px 14px",
                borderRadius: 10,
                fontWeight: 600,
                cursor: !userId || busy ? "not-allowed" : "pointer",
                opacity: !userId || busy ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {busy ? "Please wait…" : "Unlock Full Course"}
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          width: "1320px",
          maxWidth: "100%",
          margin: "14px auto 0",
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          gap: 14,
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            background: "#fff",
            color: "#111",
            borderRadius: 14,
            border: "1px solid #e7e7e7",
            padding: 12,
            height: "calc(100vh - 210px)",
            overflow: "auto",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>
            Modules
          </div>

          {modules.length === 0 ? (
            <div
              style={{
                border: "1px dashed #ddd",
                borderRadius: 12,
                padding: 12,
                opacity: 0.85,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No modules yet</div>
              <div style={{ fontSize: 16 }}>
                Vendors add modules/lessons in the Course Editor:
                <div style={{ marginTop: 6, fontWeight: 700 }}>
                  /modules/courses/{courseId}/edit
                </div>
              </div>
            </div>
          ) : (
            modules.map((m) => {
              const unlocked = isModuleUnlocked(m.id);
              const lessons = lessonsByModule[m.id] || [];

              return (
                <div
                  key={m.id}
                  style={{
                    border: "1px solid #ededed",
                    borderRadius: 12,
                    padding: 10,
                    marginBottom: 10,
                    background: unlocked ? "#fff" : "#fafafa",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 800 }}>
                      {m.title || "Untitled Module"}
                      {!unlocked ? (
                        <span style={{ marginLeft: 8, fontWeight: 800, color: "#f43f5e" }}>
                          🔒 Locked
                        </span>
                      ) : (
                        <span style={{ marginLeft: 8, fontWeight: 800, color: "#16a34a" }}>
                          ✅ Open
                        </span>
                      )}
                    </div>

                    {/* ✅ Locked modules ALWAYS go to checkout (no "module not found") */}
                    {!unlocked && (
                      <button
                        onClick={() => onLockedModuleClick(m.id)}
                        disabled={busy || !userId}
                        style={{
                          background: "#facc15",
                          border: "none",
                          padding: "8px 10px",
                          borderRadius: 10,
                          fontWeight: 700,
                          cursor: busy || !userId ? "not-allowed" : "pointer",
                          opacity: busy || !userId ? 0.7 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {busy ? "…" : "Unlock"}
                      </button>
                    )}
                  </div>

                  {!!m.description && (
                    <div style={{ marginTop: 6, fontSize: 16, opacity: 0.85 }}>
                      {m.description}
                    </div>
                  )}

                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {lessons.length === 0 ? (
                      <div style={{ fontSize: 16, opacity: 0.75 }}>
                        No lessons yet for this module.
                      </div>
                    ) : (
                      lessons.map((l) => {
                        const isActive = activeLesson?.id === l.id;

                        return (
                          <button
                            key={l.id}
                            onClick={() => {
                              if (!unlocked) {
                                onLockedModuleClick(m.id);
                                return;
                              }
                              setActiveLesson(l);
                            }}
                            style={{
                              textAlign: "left",
                              borderRadius: 10,
                              border: "1px solid #efefef",
                              padding: "10px 10px",
                              background: isActive ? "rgba(34,151,197,0.10)" : "#fff",
                              cursor: "pointer",
                              opacity: unlocked ? 1 : 0.85,
                              fontWeight: 700,
                              color: "#111",
                            }}
                          >
                            {l.title || "Lesson"}
                            {!unlocked && (
                              <span style={{ marginLeft: 8, color: "#f43f5e", fontWeight: 800 }}>
                                (Unlock)
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Player */}
        <div
          style={{
            background: "#fff",
            color: "#111",
            borderRadius: 14,
            border: "1px solid #e7e7e7",
            padding: 14,
            height: "calc(100vh - 210px)",
            overflow: "auto",
          }}
        >
          {!activeLesson ? (
            <div style={{ padding: 14, opacity: 0.85 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                No unlocked lesson selected
              </div>
              <div style={{ marginTop: 8, fontSize: 16 }}>
                Unlock a module (or the full course), then pick a lesson.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 800 }}>
                {activeLesson.title || "Lesson"}
              </div>

              <div style={{ marginTop: 8, opacity: 0.75, fontSize: 16 }}>
                Type: {activeLesson.content_type || "unknown"}
              </div>

              {!!activeLesson.description && (
                <div style={{ marginTop: 10, fontSize: 16, opacity: 0.85 }}>
                  {activeLesson.description}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {activeLesson.content_type === "video" ? (
                  <video
                    controls
                    style={{
                      width: "100%",
                      borderRadius: 12,
                      border: "1px solid #eee",
                      background: "#000",
                    }}
                    src={activeLesson.content_url || ""}
                  />
                ) : activeLesson.content_type === "pdf" ? (
                  <iframe
                    title="PDF"
                    src={activeLesson.content_url || ""}
                    style={{
                      width: "100%",
                      height: "75vh",
                      borderRadius: 12,
                      border: "1px solid #eee",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 14,
                      minHeight: 220,
                      whiteSpace: "pre-wrap",
                      fontSize: 16,
                      color: "#111",
                    }}
                  >
                    {activeLesson.content_url
                      ? `This lesson is not video/pdf.\n\ncontent_url:\n${activeLesson.content_url}`
                      : "No lesson content yet."}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
