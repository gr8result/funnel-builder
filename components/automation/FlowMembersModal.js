// /components/automation/FlowMembersModal.js
// FULL REPLACEMENT — adds Delete button per member
// ✅ Calls your existing API: /api/automation/members/remove-person
// ✅ Updates UI state after delete
// NOTE: This only works if your page imports/uses this component.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabase-client";

export default function FlowMembersModal({
  isOpen,
  onClose,
  flowId,
  flowName,
  lists = [],
  members = [],
  onImportList,
  onMemberOpen,
}) {
  const [selectedListId, setSelectedListId] = useState("");
  const [busyImport, setBusyImport] = useState(false);

  const [localMembers, setLocalMembers] = useState([]);
  const [busyDeleteId, setBusyDeleteId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setLocalMembers(Array.isArray(members) ? members : []);
  }, [members]);

  const count = useMemo(() => localMembers.length, [localMembers]);

  async function getBearer() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function handleImport() {
    setError("");
    if (!selectedListId) {
      setError("Select a list first.");
      return;
    }
    setBusyImport(true);
    try {
      await onImportList?.(selectedListId);
    } catch (e) {
      setError(e?.message || "Import failed");
    } finally {
      setBusyImport(false);
    }
  }

  async function handleDeleteMember(lead_id) {
    setError("");
    if (!flowId || !lead_id) return;

    const yes = window.confirm(
      "Remove this member from the flow?\n\nThis only removes them from this flow (it does NOT delete the lead)."
    );
    if (!yes) return;

    setBusyDeleteId(String(lead_id));
    try {
      const token = await getBearer();
      if (!token) throw new Error("Missing session token. Please log in again.");

      const res = await fetch("/api/automation/members/remove-person", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ flow_id: flowId, lead_id: String(lead_id) }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Delete failed (${res.status})`);
      }

      setLocalMembers((prev) =>
        prev.filter((m) => String(m?.id || m?.lead_id) !== String(lead_id))
      );
    } catch (e) {
      setError(e?.message || "Delete failed");
    } finally {
      setBusyDeleteId(null);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: 760,
          maxWidth: "95vw",
          borderRadius: 12,
          background: "#0b1220",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 20px 80px rgba(0,0,0,0.45)",
          color: "#fff",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>Flow Members</div>
            <div style={{ opacity: 0.85, fontSize: 12 }}>
              {flowName ? `${flowName} • ` : ""}
              {flowId}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              cursor: "pointer",
            }}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
            ADD A LIST TO THIS FLOW
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 10,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "#fff",
                padding: "0 10px",
              }}
            >
              <option value="">Select a list…</option>
              {(lists || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.title || l.id}
                </option>
              ))}
            </select>

            <button
              onClick={handleImport}
              disabled={busyImport || !selectedListId}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 10,
                background: busyImport ? "#1f7a46" : "#22c55e",
                border: "1px solid rgba(0,0,0,0.2)",
                fontWeight: 800,
                cursor: busyImport ? "not-allowed" : "pointer",
              }}
              title="Import"
            >
              {busyImport ? "Importing…" : "Import"}
            </button>

            <div
              style={{
                marginLeft: "auto",
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              Count: {count}
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            If import fails OR imports 0, the debug panel below will show why.
          </div>

          {error ? (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 10,
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.35)",
                color: "#fecaca",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 800 }}>
                MEMBERS IN THIS FLOW
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Click a member to open
              </div>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                overflow: "hidden",
              }}
            >
              {(localMembers || []).length === 0 ? (
                <div style={{ padding: 14, opacity: 0.75, fontSize: 13 }}>
                  No members in this flow yet.
                </div>
              ) : (
                localMembers.map((m) => {
                  const leadId = m?.id || m?.lead_id;
                  const name =
                    m?.name ||
                    m?.full_name ||
                    m?.first_name ||
                    m?.email ||
                    "Member";
                  const email = m?.email || "-";
                  const phone = m?.phone || "-";
                  const status = m?.status || "active";

                  return (
                    <div
                      key={String(leadId)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        cursor: "pointer",
                      }}
                      onClick={() => onMemberOpen?.(m)}
                      title="Open member"
                    >
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>
                          {name}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                          Email: {email} • Phone: {phone} • Status: {status}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMember(String(leadId));
                        }}
                        disabled={busyDeleteId === String(leadId)}
                        style={{
                          height: 30,
                          padding: "0 10px",
                          borderRadius: 10,
                          background:
                            busyDeleteId === String(leadId)
                              ? "rgba(239,68,68,0.45)"
                              : "rgba(239,68,68,0.18)",
                          border: "1px solid rgba(239,68,68,0.55)",
                          color: "#fecaca",
                          fontWeight: 900,
                          cursor:
                            busyDeleteId === String(leadId)
                              ? "not-allowed"
                              : "pointer",
                        }}
                        title="Remove from flow"
                      >
                        {busyDeleteId === String(leadId)
                          ? "Deleting…"
                          : "Delete"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
