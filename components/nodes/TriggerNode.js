// /components/nodes/TriggerNode.js
// FULL REPLACEMENT
import { Handle, Position } from "reactflow";

export default function TriggerNode({ data }) {
  const label = data?.label || "Trigger";
  const color = data?.color || "#22c55e";
  const active = Number(data?.activeCount ?? 0);

  return (
    <div
      style={{
        width: 520,
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 14px 34px rgba(0,0,0,0.35)",
        background: "rgba(56, 164, 172, 0.99)",
      }}
    >
      <div
        style={{
          background: color,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>⚡</span>
          <div style={{ fontWeight: 700, fontSize: 24, color: "#071018" }}>
            {label}
          </div>
        </div>

        <div
          style={{
            background: "rgba(2,6,23,0.35)",
            border: "1px solid rgba(2,6,23,0.45)",
            color: "#e5e7eb",
            padding: "6px 10px",
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 16,
            minWidth: 92,
            textAlign: "center",
          }}
        >
          Active: {active}
        </div>
      </div>

      <div
        style={{
          padding: "10px 14px",
          background: "rgba(2,6,23,0.55)",
          color: "#e5e7eb",
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Trigger starts the flow for all enrolled members
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: "#22c55e",
          border: "2px solid rgba(0,0,0,0.25)",
          width: 12,
          height: 12,
        }}
      />
    </div>
  );
}
