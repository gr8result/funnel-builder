// /components/automation/FlowMembersModal.js
// FULL REPLACEMENT
//
// ✅ Loads lists correctly
// ✅ Imports list members into automation_flow_members
// ✅ Uses Supabase session token directly (NO getToken bug)
// ✅ Refreshes members + count after import
// ✅ Shows real errors instead of silently failing

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase-client";

export default function FlowMembersModal({
  isOpen,
  onClose,
  flowId,
  flowName,
}) {
  const [lists, setLists] = useState([]);
  const [listId, setListId] = useState("");
  const [members, setMembers] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // -----------------------------
  // Load available email lists
  // -----------------------------
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("email_lists")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (!error) setLists(data || []);
    })();
  }, []);

  // -----------------------------
  // Load members already in flow
  // -----------------------------
  const loadMembers = async () => {
    const { data, error } = await supabase
      .from("automation_flow_members")
      .select("id,lead_id,status")
      .eq("flow_id", flowId);

    if (!error) {
      setMembers(data || []);
      setCount(data?.length || 0);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [flowId]);

  // -----------------------------
  // IMPORT LIST → FLOW
  // -----------------------------
  const importList = async () => {
    if (!listId) return alert("Select a list first");

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const res = await fetch("/api/automation/members/add-list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          flow_id: flowId,
          list_id: listId,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Import failed");
      }

      await loadMembers();
      alert(
        `Imported ${json.imported} members\nReactivated ${json.updated}`
      );
    } catch (e) {
      alert("IMPORT ERROR:\n" + e.message);
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Flow Members</h2>
        <p style={{ opacity: 0.7 }}>{flowName}</p>

        <hr />

        <label>Add a list to this flow</label>
        <select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
        >
          <option value="">Select list…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>

        <button onClick={importList} disabled={loading}>
          {loading ? "Importing…" : "Import"}
        </button>

        <hr />

        <strong>Members in this flow: {count}</strong>

        {members.length === 0 && (
          <p style={{ opacity: 0.6 }}>No members yet</p>
        )}

        <ul>
          {members.map((m) => (
            <li key={m.id}>
              {m.lead_id} — {m.status}
            </li>
          ))}
        </ul>

        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
