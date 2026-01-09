import { Handle, Position } from "reactflow";

export default function ConditionNode({ data }) {
  const c = data.condition || {};
  const summary = c.type || "No condition set";

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        background: data.color || "#a855f7",
        color: "#fff",
        width: 220,
        textAlign: "center",
        boxShadow: "0 0 12px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ fontSize: 24 }}>🔀 Condition</div>

      <div style={{ marginTop: 6, fontSize: 18 }}>
        {data.label || "Condition"}
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
        id="yes"
        style={{
          width: 16,
          height: 16,
          background: "#22c55e",
          border: "2px solid #000",
          position: "absolute",
          left: 40,
        }}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{
          width: 16,
          height: 16,
          background: "#ef4444",
          border: "2px solid #000",
          position: "absolute",
          right: 40,
        }}
      />
    </div>
  );
}
