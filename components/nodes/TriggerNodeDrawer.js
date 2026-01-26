import React, { useState } from "react";

export default function TriggerNodeDrawer({ node, onSave, onClose }) {
  const n = node || {};
  const data = n.data || {};

  const [label, setLabel] = useState(data.label || "Lead Added");
  const [triggerType, setTriggerType] = useState(
    data?.trigger?.triggerType || data?.triggerType || "lead_created"
  );

  const [tag, setTag] = useState(data?.trigger?.tag || "");
  const [listId, setListId] = useState(data?.trigger?.listId || "");
  const [eventName, setEventName] = useState(data?.trigger?.eventName || "");

  const save = () => {
    const next = {
      ...data,
      label,
      trigger: {
        ...(data.trigger || {}),
        triggerType,
        tag,
        listId,
        eventName,
      },
    };
    onSave(next);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Trigger Settings</div>
          <button onClick={onClose} style={styles.xBtn} aria-label="Close">
            ×
          </button>
        </div>

        <div style={styles.body}>
          <label style={styles.label}>Label</label>
          <input
            style={styles.input}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Lead Added"
          />

          <label style={styles.label}>Trigger Type</label>
          <select
            style={styles.input}
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
          >
            <option value="lead_created">Lead Created</option>
            <option value="list_added">Added to List</option>
            <option value="tag_added">Tag Added</option>
            <option value="purchase_completed">Purchase Completed</option>
            <option value="custom_event">Custom Event</option>
          </select>

          {triggerType === "tag_added" && (
            <>
              <label style={styles.label}>Tag</label>
              <input
                style={styles.input}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="e.g. VIP"
              />
            </>
          )}

          {triggerType === "list_added" && (
            <>
              <label style={styles.label}>List ID (optional)</label>
              <input
                style={styles.input}
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                placeholder="Paste list UUID if needed"
              />
            </>
          )}

          {triggerType === "custom_event" && (
            <>
              <label style={styles.label}>Event Name</label>
              <input
                style={styles.input}
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. webinar_registered"
              />
            </>
          )}
        </div>

        <div style={styles.footer}>
          <button onClick={save} style={styles.saveBtn}>
            Save
          </button>
          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    zIndex: 9999,
    display: "flex",
    justifyContent: "flex-end",
  },
  panel: {
    width: 420,
    height: "100%",
    background: "#0b1220",
    borderLeft: "1px solid rgba(255,255,255,0.08)",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: 16,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  xBtn: {
    background: "transparent",
    border: "none",
    color: "#fff",
    fontSize: 26,
    cursor: "pointer",
    lineHeight: 1,
  },
  body: {
    padding: 16,
    overflowY: "auto",
    flex: 1,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    margin: "10px 0 6px",
    opacity: 0.9,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
  },
  footer: {
    padding: 16,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
  },
  saveBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#22c55e",
    color: "#04110a",
    fontWeight: 900,
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
};
