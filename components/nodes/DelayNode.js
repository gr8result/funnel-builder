import { Handle, Position } from "reactflow";

export default function DelayNode({ data }) {
  const d = data.delay || {};
  const summary =
    d.mode === "absolute"
      ? `Specific: ${d.date || ""} ${d.time || ""}`
      : d.amount && d.unit
      ? `${d.amount} ${d.unit}`
      : "No delay set";

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        background: data.color || "#f97316",
        color: "#fff",
        width: 220,
        textAlign: "center",
        boxShadow: "0 0 12px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ fontSize: 24 }}>⏱ Delay</div>

      <div style={{ marginTop: 6, fontSize: 18 }}>
        {data.label || "Delay"}
      </div>

      <div style={{ marginTop: 2, fontSize: 16, opacity: 0.85 }}>
        {summary}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 16,
          height: 16,
          background: "#fff",
          border: "2px solid #000",
        }}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 16,
          height: 16,
          background: "#fff",
          border: "2px solid #000",
        }}
      />
    </div>
  );
}
