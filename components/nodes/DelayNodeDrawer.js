// /components/nodes/DelayNodeDrawer.js

import { useState } from "react";

export default function DelayNodeDrawer({ node, onSave, onClose }) {
  const initial = node?.data?.delay || {};

  const [label, setLabel] = useState(node?.data?.label || "Delay");
  const [mode, setMode] = useState(initial.mode || "relative");

  // Use explicit values from initial, not default fallbacks for amount/unit
  const [amount, setAmount] = useState(initial.amount !== undefined ? initial.amount : 1);
  const [unit, setUnit] = useState(initial.unit || "minutes");

  const [date, setDate] = useState(initial.date || "");
  const [time, setTime] = useState(initial.time || "");

  const saveAndClose = () => {
    const newData = {
      ...node.data,
      label,
      delay: {
        mode,
        amount,
        unit,
        date,
        time,
      },
    };

    onSave(newData);
  };

  return (
    <div style={s.overlay}>
      <div style={s.drawer}>
        <div style={s.header}>
          <h2>Edit Delay</h2>
          <button onClick={onClose} style={s.close}>
            ×
          </button>
        </div>

        <div style={s.body}>
          {/* LABEL */}
          <label style={s.label}>Delay Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={s.input}
            placeholder="e.g. Wait 2 days"
          />

          {/* MODE */}
          <label style={s.label}>Delay Type</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={s.input}
          >
            <option value="relative">Relative Delay</option>
            <option value="absolute">Specific Date &amp; Time</option>
          </select>

          {/* RELATIVE MODE */}
          {mode === "relative" && (
            <>
              <label style={s.label}>Amount</label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                style={s.input}
              />

              <label style={s.label}>Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                style={s.input}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </select>
            </>
          )}

          {/* ABSOLUTE MODE */}
          {mode === "absolute" && (
            <>
              <label style={s.label}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={s.input}
              />

              <label style={s.label}>Time</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={s.input}
              />
            </>
          )}
        </div>

        <div style={s.footer}>
          <button onClick={saveAndClose} style={s.saveBtn}>
            💾 Save
          </button>
          <button onClick={onClose} style={s.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    zIndex: 4000,
    display: "flex",
    justifyContent: "flex-end",
  },
  drawer: {
    width: "420px",
    height: "100%",
    background: "#0f172a",
    borderLeft: "1px solid #1e293b",
    padding: "24px",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  close: {
    fontSize: 28,
    background: "transparent",
    border: "none",
    color: "#fff",
    cursor: "pointer",
  },
  body: {
    flex: 1,
    overflowY: "auto",
  },
  label: {
    marginTop: 10,
    marginBottom: 4,
    fontWeight: 600,
  },
  input: {
    width: "100%",
    padding: "10px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#fff",
    marginBottom: 14,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    paddingTop: 12,
    borderTop: "1px solid #1e293b",
  },
  saveBtn: {
    background: "#22c55e",
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
  },
  cancelBtn: {
    background: "#ef4444",
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
  },
};
