import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ICONS from "../../../../components/iconMap";
import { supabase } from "../../../../utils/supabase-client";

const COURSE_COVERS_BUCKET = "course-covers";

export default function CourseEditor() {
  const router = useRouter();
  const { courseId } = router.query;

  const [loading, setLoading] = useState(true);
  const [savingCourse, setSavingCourse] = useState(false);

  const [userId, setUserId] = useState(null);
  const [vendor, setVendor] = useState(null);

  const [course, setCourse] = useState(null);

  // course fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [published, setPublished] = useState(false);

  // cover upload
  const [uploadingCover, setUploadingCover] = useState(false);
  const [selectedCoverFile, setSelectedCoverFile] = useState(null);

  // modules + lessons
  const [modules, setModules] = useState([]);
  const [selectedModuleId, setSelectedModuleId] = useState(null);
  const [lessons, setLessons] = useState([]);

  const selectedModule = useMemo(
    () => modules.find((m) => m.id === selectedModuleId) || null,
    [modules, selectedModuleId]
  );

  const lessonsForSelectedModule = useMemo(() => {
    if (!selectedModuleId) return [];
    return lessons
      .filter((l) => l.module_id === selectedModuleId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [lessons, selectedModuleId]);

  // UI state for editing a module
  const [modTitle, setModTitle] = useState("");
  const [modDesc, setModDesc] = useState("");
  const [modSort, setModSort] = useState(1);
  const [busyModule, setBusyModule] = useState(false);

  // UI state for editing/adding lessons
  const [busyLesson, setBusyLesson] = useState(false);
  const [lessonDraft, setLessonDraft] = useState({
    id: null,
    title: "",
    description: "",
    content_type: "video", // video | pdf | link | text
    content_url: "",
    sort_order: 1,
  });

  function showSupabaseError(prefix, error) {
    if (!error) return;
    console.error(prefix, error);
    alert(`${prefix}\n\n${error.message || JSON.stringify(error)}`);
  }

  async function loadAll() {
    if (!courseId) return;
    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;
    setUserId(uid);

    if (!uid) {
      setVendor(null);
      setCourse(null);
      setModules([]);
      setLessons([]);
      setSelectedModuleId(null);
      setLoading(false);
      return;
    }

    // vendor profile
    const { data: v, error: vErr } = await supabase
      .from("course_vendors")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();

    if (vErr) showSupabaseError("Failed loading vendor profile", vErr);
    setVendor(v || null);

    if (!v?.id) {
      setCourse(null);
      setModules([]);
      setLessons([]);
      setSelectedModuleId(null);
      setLoading(false);
      return;
    }

    // course (must belong to vendor)
    const { data: c, error: cErr } = await supabase
      .from("courses")
      .select("*")
      .eq("id", courseId)
      .eq("vendor_id", v.id)
      .single();

    if (cErr) {
      showSupabaseError("Failed loading course (or not yours)", cErr);
      setCourse(null);
      setModules([]);
      setLessons([]);
      setSelectedModuleId(null);
      setLoading(false);
      return;
    }

    setCourse(c);
    setTitle(c.title || "");
    setDescription(c.description || "");
    setCoverUrl(c.cover_url || "");
    setPublished(!!c.is_published);

    // modules
    const { data: modRows, error: modErr } = await supabase
      .from("course_modules")
      .select("*")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true });

    if (modErr) showSupabaseError("Failed loading modules", modErr);
    const mods = modRows || [];
    setModules(mods);

    // pick first module if none selected
    const initialSelected = selectedModuleId || (mods[0]?.id ?? null);
    setSelectedModuleId(initialSelected);

    // lessons for all modules
    if (mods.length) {
      const modIds = mods.map((m) => m.id);
      const { data: lessonRows, error: lessonErr } = await supabase
        .from("course_lessons")
        .select("*")
        .in("module_id", modIds)
        .order("sort_order", { ascending: true });

      if (lessonErr) showSupabaseError("Failed loading lessons", lessonErr);
      setLessons(lessonRows || []);
    } else {
      setLessons([]);
    }

    setLoading(false);
  }

  // load once when router ready
  useEffect(() => {
    if (!router.isReady) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, courseId]);

  // whenever selectedModule changes, load its fields into editor panel
  useEffect(() => {
    if (!selectedModule) {
      setModTitle("");
      setModDesc("");
      setModSort(1);
      return;
    }
    setModTitle(selectedModule.title || "");
    setModDesc(selectedModule.description || "");
    setModSort(Number(selectedModule.sort_order ?? 1));
  }, [selectedModuleId, selectedModule]);

  async function saveCourse() {
    if (!course?.id) return;
    setSavingCourse(true);
    try {
      const { error } = await supabase
        .from("courses")
        .update({
          title,
          description,
          cover_url: coverUrl || null,
          is_published: !!published,
        })
        .eq("id", course.id);

      if (error) {
        showSupabaseError("Failed to save course", error);
        return;
      }

      alert("Saved ✅");
    } finally {
      setSavingCourse(false);
    }
  }

  async function uploadCover() {
    if (!selectedCoverFile) {
      alert("Select a file first");
      return;
    }
    if (!course?.id) {
      alert("Course must be loaded before uploading a cover");
      return;
    }

    setUploadingCover(true);
    try {
      const fileNameSafe = selectedCoverFile.name.replace(/\s+/g, "_");
      const path = `covers/${course.id}_${Date.now()}_${fileNameSafe}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(COURSE_COVERS_BUCKET)
        .upload(path, selectedCoverFile, { upsert: true });

      if (uploadError) {
        showSupabaseError("Cover upload failed", uploadError);
        return;
      }

      const uploadedPath = uploadData?.path;
      if (!uploadedPath) {
        alert("Upload succeeded but no path returned. Check storage console.");
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from(COURSE_COVERS_BUCKET)
        .getPublicUrl(uploadedPath);

      const publicUrl = publicUrlData?.publicUrl || publicUrlData?.publicURL || "";
      setCoverUrl(publicUrl);
      alert("Upload complete — cover image set ✅");
      setSelectedCoverFile(null);
    } finally {
      setUploadingCover(false);
    }
  }

  // ===== MODULE CRUD =====

  async function addModule() {
    if (!courseId) return;
    if (!userId) return alert("Please log in.");

    setBusyModule(true);
    try {
      // create a basic module
      const nextSort = (modules[modules.length - 1]?.sort_order ?? modules.length) + 1;

      const { data, error } = await supabase
        .from("course_modules")
        .insert({
          course_id: courseId,
          title: `Module ${modules.length + 1}`,
          description: "",
          sort_order: nextSort,
        })
        .select("*")
        .single();

      if (error) {
        showSupabaseError("Failed to add module", error);
        return;
      }

      const newMods = [...modules, data].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
      setModules(newMods);
      setSelectedModuleId(data.id);
    } finally {
      setBusyModule(false);
    }
  }

  async function saveSelectedModule() {
    if (!selectedModuleId) return alert("Select a module first.");
    setBusyModule(true);
    try {
      const payload = {
        title: modTitle,
        description: modDesc,
        sort_order: Number(modSort || 1),
      };

      const { data, error } = await supabase
        .from("course_modules")
        .update(payload)
        .eq("id", selectedModuleId)
        .select("*")
        .single();

      if (error) {
        showSupabaseError(
          "Failed to save module.\n\nIf this keeps happening, it’s usually RLS blocking UPDATE on course_modules.",
          error
        );
        return;
      }

      setModules((prev) =>
        prev
          .map((m) => (m.id === selectedModuleId ? data : m))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      );

      alert("Module saved ✅");
    } finally {
      setBusyModule(false);
    }
  }

  async function deleteSelectedModule() {
    if (!selectedModuleId) return;
    if (!confirm("Delete this module AND all its lessons?")) return;

    setBusyModule(true);
    try {
      // delete lessons first (FK safety)
      const { error: lErr } = await supabase
        .from("course_lessons")
        .delete()
        .eq("module_id", selectedModuleId);

      if (lErr) {
        showSupabaseError("Failed deleting lessons for module", lErr);
        return;
      }

      const { error } = await supabase.from("course_modules").delete().eq("id", selectedModuleId);

      if (error) {
        showSupabaseError("Failed deleting module", error);
        return;
      }

      const remaining = modules.filter((m) => m.id !== selectedModuleId);
      setModules(remaining);
      setLessons((prev) => prev.filter((l) => l.module_id !== selectedModuleId));
      setSelectedModuleId(remaining[0]?.id ?? null);
      alert("Module deleted ✅");
    } finally {
      setBusyModule(false);
    }
  }

  // ===== LESSON CRUD =====

  async function addLesson() {
    if (!selectedModuleId) return alert("Select a module first.");
    const nextSort =
      (lessonsForSelectedModule[lessonsForSelectedModule.length - 1]?.sort_order ??
        lessonsForSelectedModule.length) + 1;

    setLessonDraft({
      id: null,
      title: `Lesson ${lessonsForSelectedModule.length + 1}`,
      description: "",
      content_type: "video",
      content_url: "",
      sort_order: nextSort,
    });
  }

  async function saveLesson() {
    if (!selectedModuleId) return alert("Select a module first.");
    if (!lessonDraft.title?.trim()) return alert("Lesson title is required.");

    setBusyLesson(true);
    try {
      const payload = {
        module_id: selectedModuleId,
        title: lessonDraft.title.trim(),
        description: lessonDraft.description || "",
        content_type: lessonDraft.content_type || "video",
        content_url: lessonDraft.content_url || "",
        sort_order: Number(lessonDraft.sort_order || 1),
      };

      if (lessonDraft.id) {
        const { data, error } = await supabase
          .from("course_lessons")
          .update(payload)
          .eq("id", lessonDraft.id)
          .select("*")
          .single();

        if (error) {
          showSupabaseError(
            "Failed to update lesson.\n\nUsually RLS blocking UPDATE on course_lessons.",
            error
          );
          return;
        }

        setLessons((prev) => prev.map((l) => (l.id === lessonDraft.id ? data : l)));
        alert("Lesson updated ✅");
      } else {
        const { data, error } = await supabase
          .from("course_lessons")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          showSupabaseError(
            "Failed to create lesson.\n\nUsually RLS blocking INSERT on course_lessons.",
            error
          );
          return;
        }

        setLessons((prev) => [...prev, data]);
        alert("Lesson created ✅");
      }
    } finally {
      setBusyLesson(false);
    }
  }

  async function deleteLesson(lessonId) {
    if (!confirm("Delete this lesson?")) return;

    setBusyLesson(true);
    try {
      const { error } = await supabase.from("course_lessons").delete().eq("id", lessonId);
      if (error) {
        showSupabaseError("Failed deleting lesson", error);
        return;
      }
      setLessons((prev) => prev.filter((l) => l.id !== lessonId));
      if (lessonDraft.id === lessonId) {
        setLessonDraft({
          id: null,
          title: "",
          description: "",
          content_type: "video",
          content_url: "",
          sort_order: 1,
        });
      }
      alert("Lesson deleted ✅");
    } finally {
      setBusyLesson(false);
    }
  }

  function editLesson(lesson) {
    setLessonDraft({
      id: lesson.id,
      title: lesson.title || "",
      description: lesson.description || "",
      content_type: lesson.content_type || "video",
      content_url: lesson.content_url || "",
      sort_order: Number(lesson.sort_order || 1),
    });
  }

  // ===== UI =====

  return (
    <div style={page.wrap}>
      <div style={page.inner}>
        {/* Banner */}
        <div style={page.banner}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={page.iconWrap}>{ICONS.courses({ size: 32, color: "#fff" })}</div>
            <div>
              <h1 style={page.title}>Course Editor</h1>
              <p style={page.subtitle}>Edit course + add modules/lessons (no Supabase access needed).</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href="/modules/courses/vendor" style={{ textDecoration: "none" }}>
              <button type="button" style={page.backBtn}>← Vendor Console</button>
            </Link>
            <Link href="/modules/courses" style={{ textDecoration: "none" }}>
              <button type="button" style={page.backBtn}>← Marketplace</button>
            </Link>
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <button type="button" style={page.backBtn}>← Dashboard</button>
            </Link>
          </div>
        </div>

        <div style={page.panel}>
          {!userId ? (
            <div style={page.empty}>Please log in.</div>
          ) : loading ? (
            <div style={page.empty}>Loading…</div>
          ) : !vendor?.id ? (
            <div style={page.empty}>No vendor profile found for your account.</div>
          ) : !course ? (
            <div style={page.empty}>Course not found (or not yours).</div>
          ) : (
            <>
              {/* COURSE SETTINGS */}
              <div style={page.sectionTitle}>Course Settings</div>

              <div style={page.formGrid}>
                <div>
                  <div style={page.label}>Course Title</div>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={page.input}
                  />
                </div>

                <div>
                  <div style={page.label}>Cover Image</div>

                  {coverUrl ? (
                    <div style={{ marginBottom: 8 }}>
                      <img
                        src={coverUrl}
                        alt="cover preview"
                        style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8 }}
                      />
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setSelectedCoverFile(e.target.files?.[0] || null)}
                      style={{ padding: 6 }}
                    />
                    <button
                      type="button"
                      onClick={uploadCover}
                      disabled={uploadingCover || !selectedCoverFile}
                      style={page.secondaryBtn}
                    >
                      {uploadingCover ? "Uploading…" : "Upload"}
                    </button>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                      Or paste an image URL (optional)
                    </div>
                    <input
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="https://..."
                      style={page.input}
                    />
                  </div>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={page.label}>Description</div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    style={page.textarea}
                  />
                </div>

                <label style={page.checkRow}>
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                  />
                  <span style={{ fontWeight: 900 }}>Published (shows in Marketplace)</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={saveCourse}
                  disabled={savingCourse}
                  style={page.primaryBtn}
                >
                  {savingCourse ? "Saving…" : "Save Course"}
                </button>

                <Link href={`/modules/courses/${courseId}/pricing`} style={{ textDecoration: "none" }}>
                  <button type="button" style={page.secondaryBtn}>Pricing →</button>
                </Link>

                <Link href={`/modules/courses/${courseId}/learn`} style={{ textDecoration: "none" }}>
                  <button type="button" style={page.secondaryBtn}>Preview Player →</button>
                </Link>
              </div>

              {/* MODULES + LESSONS */}
              <div style={{ height: 18 }} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={page.sectionTitle}>Modules & Lessons</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={addModule} disabled={busyModule} style={page.secondaryBtn}>
                    {busyModule ? "Working…" : "+ Add Module"}
                  </button>
                  <button
                    type="button"
                    onClick={addLesson}
                    disabled={busyLesson || !selectedModuleId}
                    style={page.secondaryBtn}
                  >
                    + Add Lesson
                  </button>
                </div>
              </div>

              <div style={page.grid2}>
                {/* MODULE LIST + EDIT */}
                <div style={page.card}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Modules</div>

                  {modules.length === 0 ? (
                    <div style={page.emptyBox}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>No modules yet</div>
                      <div style={{ fontSize: 16, opacity: 0.85 }}>
                        Click <b>+ Add Module</b>.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {modules.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedModuleId(m.id)}
                          style={{
                            ...page.modulePill,
                            borderColor: m.id === selectedModuleId ? "#22c55e" : "#243047",
                            background: m.id === selectedModuleId ? "rgba(34,197,94,0.12)" : "#0b1220",
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{m.title || "Untitled Module"}</div>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>Sort: {m.sort_order ?? "-"}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* EDIT SELECTED MODULE */}
                  <div style={{ height: 12 }} />

                  {!selectedModuleId ? (
                    <div style={{ opacity: 0.85, fontSize: 16 }}>Select a module to edit.</div>
                  ) : (
                    <div style={page.editBox}>
                      <div style={page.label}>Title</div>
                      <input value={modTitle} onChange={(e) => setModTitle(e.target.value)} style={page.input} />

                      <div style={{ height: 10 }} />
                      <div style={page.label}>Description</div>
                      <textarea
                        value={modDesc}
                        onChange={(e) => setModDesc(e.target.value)}
                        style={{ ...page.textarea, minHeight: 90 }}
                      />

                      <div style={{ height: 10 }} />
                      <div style={page.label}>Sort order</div>
                      <input
                        value={modSort}
                        onChange={(e) => setModSort(e.target.value)}
                        style={page.input}
                      />

                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={saveSelectedModule}
                          disabled={busyModule}
                          style={{ ...page.primaryBtn, background: "#22c55e", color: "#06120a" }}
                        >
                          {busyModule ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={deleteSelectedModule}
                          disabled={busyModule}
                          style={{ ...page.primaryBtn, background: "#ef4444", color: "#fff" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* LESSON LIST + EDIT */}
                <div style={page.card}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>
                    Lessons {selectedModule ? <span style={{ opacity: 0.7 }}>(module selected)</span> : null}
                  </div>

                  {!selectedModuleId ? (
                    <div style={page.emptyBox}>Select a module first.</div>
                  ) : lessonsForSelectedModule.length === 0 ? (
                    <div style={page.emptyBox}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>No lessons in this module</div>
                      <div style={{ fontSize: 16, opacity: 0.85 }}>
                        Click <b>+ Add Lesson</b>.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {lessonsForSelectedModule.map((l) => (
                        <div key={l.id} style={page.lessonRow}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 900 }}>{l.title || "Lesson"}</div>
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                              {l.content_type || "unknown"} • sort {l.sort_order ?? "-"}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => editLesson(l)}
                            style={page.smallBtn}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteLesson(l.id)}
                            style={{ ...page.smallBtn, background: "#ef4444", borderColor: "#ef4444" }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ height: 14 }} />

                  {/* LESSON EDITOR */}
                  {!selectedModuleId ? null : (
                    <div style={page.editBox}>
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>
                        {lessonDraft.id ? "Edit Lesson" : "New Lesson"}
                      </div>

                      <div style={page.label}>Title</div>
                      <input
                        value={lessonDraft.title}
                        onChange={(e) => setLessonDraft((p) => ({ ...p, title: e.target.value }))}
                        style={page.input}
                      />

                      <div style={{ height: 10 }} />
                      <div style={page.label}>Description</div>
                      <textarea
                        value={lessonDraft.description}
                        onChange={(e) => setLessonDraft((p) => ({ ...p, description: e.target.value }))}
                        style={{ ...page.textarea, minHeight: 90 }}
                      />

                      <div style={{ height: 10 }} />
                      <div style={page.label}>Content type</div>
                      <select
                        value={lessonDraft.content_type}
                        onChange={(e) => setLessonDraft((p) => ({ ...p, content_type: e.target.value }))}
                        style={page.input}
                      >
                        <option value="video">video</option>
                        <option value="pdf">pdf</option>
                        <option value="link">link</option>
                        <option value="text">text</option>
                      </select>

                      <div style={{ height: 10 }} />
                      <div style={page.label}>Content URL</div>
                      <input
                        value={lessonDraft.content_url}
                        onChange={(e) => setLessonDraft((p) => ({ ...p, content_url: e.target.value }))}
                        style={page.input}
                        placeholder="https://..."
                      />

                      <div style={{ height: 10 }} />
                      <div style={page.label}>Sort order</div>
                      <input
                        value={lessonDraft.sort_order}
                        onChange={(e) => setLessonDraft((p) => ({ ...p, sort_order: e.target.value }))}
                        style={page.input}
                      />

                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={saveLesson}
                          disabled={busyLesson}
                          style={{ ...page.primaryBtn, background: "#facc15", color: "#111" }}
                        >
                          {busyLesson ? "Saving…" : "Save Lesson"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setLessonDraft({
                              id: null,
                              title: "",
                              description: "",
                              content_type: "video",
                              content_url: "",
                              sort_order: 1,
                            })
                          }
                          style={page.secondaryBtn}
                        >
                          Clear
                        </button>
                      </div>

                      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                        Tip: If Save fails, the alert will show the real error (usually RLS).
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 14, opacity: 0.65, fontSize: 12 }}>
                Debug marker: <b>COURSE-EDIT-ALL-IN-ONE-v3</b>
              </div>
            </>
          )}
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
    fontSize: 16, // ✅ minimum text size
  },
  inner: { width: "100%", maxWidth: 1320, margin: "0 auto" },

  banner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#ec4899",
    borderRadius: 12,
    padding: "18px 22px",
    marginBottom: 18,
    fontWeight: 700,
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
  title: { fontSize: 26, margin: 0 },
  subtitle: { fontSize: 15, opacity: 0.9, margin: 0, marginTop: 4 },

  backBtn: {
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  panel: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 12,
    padding: 14,
  },

  empty: { padding: 14, opacity: 0.9 },

  sectionTitle: { fontWeight: 900, marginBottom: 10 },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },

  label: { fontWeight: 900, marginBottom: 6 },

  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 10,
    border: "1px solid #334155",
    fontSize: 16,
    outline: "none",
    background: "#0b1220",
    color: "#fff",
  },

  textarea: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 10,
    border: "1px solid #334155",
    fontSize: 16,
    outline: "none",
    background: "#0b1220",
    color: "#fff",
    minHeight: 140,
    resize: "vertical",
  },

  checkRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 6 },

  primaryBtn: {
    background: "#facc15",
    color: "#000",
    border: "none",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 10,
  },

  card: {
    background: "#0b1220",
    border: "1px solid #1f2937",
    borderRadius: 12,
    padding: 12,
    minHeight: 320,
  },

  emptyBox: {
    border: "1px dashed #2a3550",
    borderRadius: 12,
    padding: 12,
    opacity: 0.9,
  },

  modulePill: {
    textAlign: "left",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #243047",
    cursor: "pointer",
    color: "#fff",
  },

  editBox: {
    marginTop: 12,
    border: "1px solid #1f2937",
    borderRadius: 12,
    padding: 12,
    background: "#0a1020",
  },

  lessonRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: 10,
    border: "1px solid #1f2937",
    borderRadius: 12,
    background: "#0a1020",
  },

  smallBtn: {
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
