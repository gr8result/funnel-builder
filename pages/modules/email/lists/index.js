// /pages/modules/email/lists/index.js
// GR8 RESULT — BULK DELETE + BIG CHECKBOXES + NAME SORTING + SHARED AVATARS
// ✅ Restores click-to-open Lead Details modal (row click)
// ✅ Prevents row-click when using checkbox / edit / delete buttons
// ✅ Loads stages from crm_pipelines (first pipeline) for LeadDetailsModal

import { useState, useEffect, useMemo } from "react";
import Head from "next/head";
import { supabase } from "../../../../utils/supabase-client";
import EditListModal from "/components/lists/EditListModal";
import SubscriberAvatar from "/components/crm/SubscriberAvatar";
import LeadDetailsModal from "/components/crm/LeadDetailsModal";
import { getAvatarForLead } from "../../../../utils/avatar";

export default function EmailListsDashboard() {
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSubscriber, setEditingSubscriber] = useState(false);
  const [editingListModal, setEditingListModal] = useState(null);
  const [userId, setUserId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const [showAllMode, setShowAllMode] = useState(false);

  // name sort: "asc" | "desc"
  const [nameSort, setNameSort] = useState("asc");

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    source: "",
    tags: "",
    notes: "",
    list_id: "",
    id: undefined,
  });

  // IMPORT CSV modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importListId, setImportListId] = useState("");
  const [importFile, setImportFile] = useState(null);

  // ✅ Lead Details modal state
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [stages, setStages] = useState([]);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (userId) {
      loadLists();
      loadStages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) setUserId(user.id);
  }

  async function loadStages() {
    try {
      const { data, error } = await supabase
        .from("crm_pipelines")
        .select("stages")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (error) {
        console.error("loadStages error:", error);
        setStages([]);
        return;
      }

      const first = data?.[0];
      const s = first?.stages;

      if (Array.isArray(s)) setStages(s);
      else if (typeof s === "string") {
        try {
          const parsed = JSON.parse(s);
          setStages(Array.isArray(parsed) ? parsed : []);
        } catch {
          setStages([]);
        }
      } else {
        setStages([]);
      }
    } catch (e) {
      console.error("loadStages exception:", e);
      setStages([]);
    }
  }

  async function loadLists() {
    const { data, error } = await supabase
      .from("lead_lists")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return;
    }

    setLists(data || []);

    if (data?.length > 0) {
      setSelectedList(data[0]);
      loadSubscribers(data[0].id);
    } else {
      setSelectedList(null);
      setSubscribers([]);
      setLoading(false);
    }
  }

  async function loadSubscribers(listId) {
    if (!listId) return;

    setShowAllMode(false); // auto disable show-all
    setLoading(true);

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("list_id", listId)
      .order("created_at", { ascending: false });

    if (!error) setSubscribers(data || []);

    setLoading(false);
    setSelectedIds([]);
  }

  // Show All Subscribers
  async function loadAllSubscribers() {
    setShowAllMode(true);
    setSelectedList(null);
    setLoading(true);

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setSubscribers(data || []);

    setLoading(false);
    setSelectedIds([]);
  }

  function getListName(id) {
    const l = lists.find((x) => x.id === id);
    return l ? l.name : "—";
  }

  function getActionColor(action) {
    if (!action) return "#374151";
    switch (action) {
      case "CRM":
        return "#3b82f6";
      case "Automation":
        return "#7c3aed";
      case "Both":
        return "#06b6d4";
      default:
        return "#374151";
    }
  }

  // ✅ Open Lead Details modal
  function openLeadDetails(lead) {
    setSelectedLead(lead);
    setIsLeadModalOpen(true);
  }

  // EXPORT CSV
  function exportCSV() {
    if (!subscribers || subscribers.length === 0) {
      alert("No subscribers to export.");
      return;
    }

    const header = "Name,Email,Phone,Source,Tags,Notes,List\n";

    const rows = subscribers
      .map((s) => {
        return [
          s.name || "",
          s.email || "",
          s.phone || "",
          s.source || "",
          s.tags || "",
          (s.notes || "").replace(/,/g, ";"),
          getListName(s.list_id),
        ].join(",");
      })
      .join("\n");

    const blob = new Blob([header + rows], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "subscribers.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // IMPORT CSV HANDLING
  function openImportCSV() {
    setImportFile(null);
    setImportListId("");
    setShowImportModal(true);
  }

  function handleCSVSelected(e) {
    const file = e.target.files[0];
    setImportFile(file);
  }

  async function processCSV() {
    if (!importFile) {
      alert("Select a file first.");
      return;
    }
    if (!importListId) {
      alert("Choose which list to import into.");
      return;
    }

    const text = await importFile.text();
    const lines = text.split("\n").slice(1);

    const imported = [];

    for (let line of lines) {
      if (!line.trim()) continue;
      const [name, email, phone, source, tags, notes] = line.split(",");

      const base = {
        user_id: userId,
        list_id: importListId,
        name: (name || "").trim(),
        email: (email || "").trim(),
        phone: (phone || "").trim(),
        source: (source || "").trim(),
        tags: (tags || "").trim(),
        notes: (notes || "").trim(),
      };

      const { emoji, color } = getAvatarForLead(base);

      imported.push({
        ...base,
        avatar_icon: emoji,
        avatar_color: color,
      });
    }

    const { error } = await supabase.from("leads").insert(imported);

    if (error) {
      console.error(error);
      alert("CSV import failed.");
    } else {
      alert("CSV imported!");
      setShowImportModal(false);
      loadSubscribers(importListId);
    }
  }

  // ------ ADD NEW LIST ------ //
  function openAddList() {
    setEditingListModal({
      id: null,
      name: "",
      source_type: "",
      api_key: "",
      form_url: "",
      tags: "",
      auto_add_crm: false,
      pipelines: [],
      flows: [],
    });
  }

  // ------ EDIT LIST ------ //
  function openEditList(list) {
    setEditingListModal(list);
  }

  function onListSaved() {
    setEditingListModal(null);
    loadLists();
  }

  // ------ ADD SUBSCRIBER ------ //
  function openAddSubscriber() {
    if (!selectedList) {
      alert("Select a list first.");
      return;
    }

    setForm({
      name: "",
      email: "",
      phone: "",
      source: "",
      tags: "",
      notes: "",
      list_id: selectedList.id,
      id: undefined,
    });

    setEditingSubscriber("new");
  }

  function openEditSubscriber(sub) {
    setForm({
      name: sub.name,
      email: sub.email,
      phone: sub.phone,
      source: sub.source,
      tags: sub.tags,
      notes: sub.notes,
      list_id: sub.list_id,
      id: sub.id,
    });
    setEditingSubscriber("edit");
  }

  // ✅ FIXED: correct payload + avatar saving, matching Leads page
  async function saveSubscriber() {
    if (!form.email.trim()) {
      alert("Email required");
      return;
    }

    const basePayload = {
      user_id: userId,
      list_id: form.list_id,
      name: (form.name || "").trim(),
      email: (form.email || "").trim(),
      phone: (form.phone || "").trim(),
      source: (form.source || "").trim(),
      tags: (form.tags || "").trim(),
      notes: (form.notes || "").trim(),
    };

    const { emoji, color } = getAvatarForLead(basePayload);

    const payload = {
      ...basePayload,
      avatar_icon: emoji,
      avatar_color: color,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingSubscriber === "edit") {
      ({ error } = await supabase
        .from("leads")
        .update(payload)
        .eq("id", form.id));
    } else {
      ({ error } = await supabase.from("leads").insert([payload]));
    }

    if (error) {
      console.error("Save subscriber error:", error);
      alert("Failed to save subscriber.");
      return;
    }

    setEditingSubscriber(false);

    if (showAllMode) loadAllSubscribers();
    else loadSubscribers(form.list_id);
  }

  async function deleteSubscriber(id) {
    if (!confirm("Delete this subscriber?")) return;

    await supabase.from("leads").delete().eq("id", id);

    if (showAllMode) loadAllSubscribers();
    else loadSubscribers(selectedList?.id);
  }

  // ------ BULK DELETE SELECTED ------ //
  async function deleteSelectedSubscribers() {
    if (!selectedIds.length) {
      alert("No subscribers selected.");
      return;
    }

    if (
      !confirm(
        `Delete ${selectedIds.length} selected subscriber${
          selectedIds.length > 1 ? "s" : ""
        }?`
      )
    ) {
      return;
    }

    await supabase.from("leads").delete().in("id", selectedIds);

    if (showAllMode) await loadAllSubscribers();
    else await loadSubscribers(selectedList?.id);
    setSelectedIds([]);
  }

  // ------ SORTED SUBSCRIBERS (BY NAME) ------ //
  const sortedSubscribers = useMemo(() => {
    const arr = [...subscribers];
    if (nameSort === "asc") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (nameSort === "desc") {
      arr.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
    }
    return arr;
  }, [subscribers, nameSort]);

  // --------------------------------------------------------------------
  // RENDER PAGE
  // --------------------------------------------------------------------
  return (
    <>
      <Head>
        <title>Email Lists • Subscribers</title>
      </Head>

      <main
        style={{
          background: "#0c121a",
          color: "#fff",
          minHeight: "100vh",
          padding: "24px 0 40px",
        }}
      >
        <div style={{ width: "1320px", margin: "0 auto" }}>
          {/* HEADER */}
          <div
            style={{
              background: "linear-gradient(90deg,#0ea5e9,#2563eb)",
              borderRadius: "12px",
              padding: "18px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "24px",
            }}
          >
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <span style={{ fontSize: "48px" }}>📥</span>
              <div>
                <h1 style={{ margin: 0, fontSize: "48px" }}>
                  Email Lists & Subscribers
                </h1>
                <p style={{ margin: 0, opacity: 0.9 }}>
                  Manage, import, edit and organise your subscribers.
                </p>
              </div>
            </div>

            <button
              onClick={() => history.back()}
              style={{
                background: "#1e293b",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "8px",
                padding: "10px 20px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              ⬅ Back
            </button>
          </div>

          <div style={{ display: "flex", gap: "24px" }}>
            {/* SIDEBAR */}
            <aside
              style={{
                width: "320px",
                background: "#0f1724",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.05)",
                padding: "14px",
                flexShrink: 0,
              }}
            >
              <h3>Lists</h3>

              <div
                style={{
                  maxHeight: "520px",
                  overflowY: "auto",
                  marginBottom: "10px",
                }}
              >
                {lists.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      background:
                        selectedList?.id === l.id && !showAllMode
                          ? "#2563eb"
                          : "#111827",
                      borderRadius: "6px",
                      padding: "12px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <button
                        style={{
                          flex: 1,
                          border: "none",
                          background: "transparent",
                          color: "#fff",
                          fontWeight: "600",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          loadSubscribers(l.id);
                          setSelectedList(l);
                        }}
                      >
                        {l.name}
                      </button>

                      <span
                        style={{
                          background: getActionColor(l.action),
                          color: "#fff",
                          borderRadius: "6px",
                          padding: "10px 12px",
                          fontSize: "16px",
                          fontWeight: "700",
                          marginRight: "6px",
                        }}
                      >
                        {l.action || "None"}
                      </span>

                      <span
                        style={{
                          cursor: "pointer",
                          color: "#38bdf8",
                          marginLeft: "6px",
                        }}
                        onClick={() => openEditList(l)}
                      >
                        ✏️
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <button
                style={{
                  background: "#16a34a",
                  color: "#fff",
                  width: "100%",
                  marginTop: "10px",
                  border: "none",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
                onClick={openAddList}
              >
                + Add List
              </button>

              <button
                style={{
                  background: "#7c3aed",
                  color: "#fff",
                  width: "100%",
                  marginTop: "8px",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
                onClick={openAddSubscriber}
              >
                + Add Subscriber
              </button>

              <button
                onClick={loadAllSubscribers}
                style={{
                  background: "#475569",
                  color: "#fff",
                  width: "100%",
                  marginTop: "14px",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                Show All Subscribers
              </button>

              <button
                style={{
                  background: "#0284c7",
                  color: "#fff",
                  width: "100%",
                  marginTop: "12px",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
                onClick={openImportCSV}
              >
                📤 Import CSV
              </button>

              <button
                style={{
                  background: "#14b8a6",
                  color: "#fff",
                  width: "100%",
                  marginTop: "10px",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
                onClick={exportCSV}
              >
                📥 Export CSV
              </button>
            </aside>

            {/* SUBSCRIBERS TABLE */}
            <section
              style={{
                width: "calc(100% - 360px)",
                background: "#0f1724",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.03)",
                padding: "18px",
              }}
            >
              {!showAllMode && selectedList && (
                <h3 style={{ marginBottom: "10px" }}>📋 {selectedList.name}</h3>
              )}

              {/* SELECT/CLEAR/BULK DELETE */}
              {!loading && subscribers.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "10px",
                    marginBottom: "12px",
                  }}
                >
                  <button
                    onClick={() =>
                      setSelectedIds(sortedSubscribers.map((s) => s.id))
                    }
                    style={{
                      background: "#2563eb",
                      border: "none",
                      borderRadius: "6px",
                      fontWeight: "700",
                      color: "#fff",
                      padding: "6px 12px",
                      cursor: "pointer",
                    }}
                  >
                    Select All
                  </button>

                  <button
                    onClick={() => setSelectedIds([])}
                    style={{
                      background: "#4b5563",
                      border: "none",
                      borderRadius: "6px",
                      fontWeight: "700",
                      color: "#fff",
                      padding: "6px 12px",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>

                  <button
                    onClick={deleteSelectedSubscribers}
                    style={{
                      background: "#dc2626",
                      border: "none",
                      borderRadius: "6px",
                      fontWeight: "600",
                      color: "#fff",
                      padding: "16px 18px",
                      cursor: "pointer",
                    }}
                  >
                    🗑️ Delete Selected
                  </button>
                </div>
              )}

              {loading ? (
                <p>Loading subscribers...</p>
              ) : subscribers.length === 0 ? (
                <p>No subscribers found.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th></th>
                      <th
                        onClick={() =>
                          setNameSort((prev) => (prev === "asc" ? "desc" : "asc"))
                        }
                        style={{ cursor: "pointer", userSelect: "none" }}
                      >
                        Name {nameSort === "asc" ? "▲" : "▼"}
                      </th>
                      <th>Email</th>
                      <th>Phone</th>

                      {showAllMode && <th>List</th>}

                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedSubscribers.map((s) => {
                      return (
                        <tr
                          key={s.id}
                          onClick={() => openLeadDetails(s)}
                          style={{
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(s.id)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() =>
                                setSelectedIds((prev) =>
                                  prev.includes(s.id)
                                    ? prev.filter((x) => x !== s.id)
                                    : [...prev, s.id]
                                )
                              }
                              style={{
                                width: "18px",
                                height: "18px",
                                cursor: "pointer",
                              }}
                            />
                          </td>

                          <td>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              {/* Shared avatar component */}
                              <SubscriberAvatar lead={s} size={32} fontSize={24} />
                              <span>{s.name || "-"}</span>
                            </div>
                          </td>
                          <td>{s.email}</td>
                          <td>{s.phone || "-"}</td>

                          {showAllMode && <td>{getListName(s.list_id)}</td>}

                          <td style={{ textAlign: "right" }}>
                            <button
                              style={{
                                background: "#2563eb",
                                color: "#fff",
                                border: "none",
                                borderRadius: "6px",
                                width: "48px",
                                height: "48px",
                                marginRight: "16px",
                                marginBottom: "16px",
                                cursor: "pointer",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditSubscriber(s);
                              }}
                            >
                              ✏️
                            </button>

                            <button
                              style={{
                                background: "#dc2626",
                                color: "#fff",
                                border: "none",
                                borderRadius: "6px",
                                width: "48px",
                                height: "48px",
                                cursor: "pointer",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSubscriber(s.id);
                              }}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>

        {/* ✅ LEAD DETAILS MODAL */}
        <LeadDetailsModal
          isOpen={isLeadModalOpen}
          lead={selectedLead}
          stages={stages}
          userId={userId}
          fontScale={1.35}
          onClose={() => {
            setIsLeadModalOpen(false);
            setSelectedLead(null);
          }}
          onNotesUpdated={(leadId, notes) => {
            // keep this page in sync if notes changed
            setSubscribers((prev) =>
              (prev || []).map((x) => (x.id === leadId ? { ...x, notes } : x))
            );
          }}
        />

        {/* EDIT SUBSCRIBER MODAL */}
        {editingSubscriber && (
          <div
            onClick={() => setEditingSubscriber(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 999,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#0b1220",
                padding: "20px",
                borderRadius: "10px",
                width: "420px",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <h3>
                {editingSubscriber === "edit" ? "Edit Subscriber" : "Add Subscriber"}
              </h3>

              {/* INPUTS */}
              {["name", "email", "phone", "source", "tags", "notes"].map((f) => (
                <div
                  key={f}
                  style={{
                    marginBottom: "10px",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <label
                    style={{
                      marginBottom: "16px",
                      fontSize: "16px",
                      color: "#cbd5e1",
                    }}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </label>

                  <input
                    type="text"
                    value={form[f] || ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        [f]: e.target.value,
                      }))
                    }
                    style={{
                      padding: "16px",
                      borderRadius: "6px",
                      border: "1px solid #1f2a37",
                      background: "#0f1724",
                      color: "#fff",
                    }}
                  />
                </div>
              ))}

              {/* LIST DROPDOWN */}
              <div
                style={{
                  marginBottom: "16px",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <label
                  style={{
                    marginBottom: "16px",
                    fontSize: "18px",
                    color: "#cbd5e1",
                  }}
                >
                  List
                </label>

                <select
                  value={form.list_id || ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      list_id: e.target.value,
                    }))
                  }
                  style={{
                    padding: "16px",
                    borderRadius: "6px",
                    border: "1px solid #1f2a37",
                    background: "#0f1724",
                    color: "#fff",
                  }}
                >
                  <option value="">— Select List —</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* BUTTONS */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  marginTop: "16px",
                }}
              >
                <button
                  onClick={saveSubscriber}
                  style={{
                    background: "#22c55e",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: "700",
                    color: "#fff",
                    padding: "18px 14px",
                    cursor: "pointer",
                  }}
                >
                  💾 Save
                </button>

                <button
                  onClick={() => setEditingSubscriber(false)}
                  style={{
                    background: "#4b5563",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: "700",
                    color: "#fff",
                    padding: "18px 14px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* IMPORT CSV MODAL */}
        {showImportModal && (
          <div
            onClick={() => setShowImportModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 999,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#0b1220",
                padding: "20px",
                borderRadius: "10px",
                width: "420px",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <h3>Import CSV</h3>

              <label
                style={{
                  marginBottom: "12px",
                  fontSize: "16px",
                  color: "#cbd5e1",
                }}
              >
                Choose List
              </label>

              <select
                value={importListId}
                onChange={(e) => setImportListId(e.target.value)}
                style={{
                  padding: "12px",
                  width: "100%",
                  borderRadius: "6px",
                  border: "1px solid #1f2a37",
                  background: "#0f1724",
                  color: "#fff",
                  marginBottom: "20px",
                }}
              >
                <option value="">— Select List —</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>

              <input
                type="file"
                accept=".csv"
                onChange={handleCSVSelected}
                style={{ marginBottom: "20px" }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                }}
              >
                <button
                  onClick={processCSV}
                  style={{
                    background: "#22c55e",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: "700",
                    color: "#fff",
                    padding: "12px 16px",
                    cursor: "pointer",
                  }}
                >
                  Import
                </button>

                <button
                  onClick={() => setShowImportModal(false)}
                  style={{
                    background: "#4b5563",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: "700",
                    color: "#fff",
                    padding: "12px 16px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EDIT LIST MODAL */}
        {editingListModal && (
          <EditListModal
            userId={userId}
            list={editingListModal}
            onClose={() => setEditingListModal(null)}
            onSaved={onListSaved}
          />
        )}
      </main>
    </>
  );
}
