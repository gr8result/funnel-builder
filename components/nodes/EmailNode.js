// /components/nodes/EmailNode.js
import React from "react";
import { Handle, Position } from "reactflow";

function StatRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.22)",
        background: "rgba(2,6,23,0.22)",
        fontSize: 16,
        fontWeight: 600,
        color: "#fff",
        lineHeight: 1.1,
      }}
      title={`${label}: ${value ?? 0}`}
    >
      <span style={{ opacity: 0.92 }}>{label}</span>
      <span
        style={{
          padding: "3px 10px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.12)",
          border: "1px solid rgba(255,255,255,0.15)",
          minWidth: 34,
          textAlign: "center",
        }}
      >
        {value ?? 0}
      </span>
    </div>
  );
}

export default function EmailNode({ data }) {
  const previewUrl =
    data?.emailPreviewUrl ||
    data?.thumbnailUrl ||
    null;

  const stats = data?.stats || {};
  const processed = Number(stats.processed || 0);
  const delivered = Number(stats.delivered || 0);
  const opened = Number(stats.opened || 0);
  const clicked = Number(stats.clicked || 0);
  const bounced = Number(stats.bounced || 0);
  const unsubscribed = Number(stats.unsubscribed || 0);

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: data?.color || "#3b82f6",
        color: "#fff",
        width: 420,            // ✅ wider
        textAlign: "left",
        boxShadow: "0 0 12px rgba(0,0,0,0.5)",
        position: "relative",
      }}
    >
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          ✉️ {data?.label || "Email"}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.9 }}>
          {data?.emailName || "No email selected"}
        </div>
      </div>

      {/* BODY: LEFT preview, RIGHT stats */}
      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "190px 1fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* LEFT: PREVIEW */}
        <div
          style={{
            borderRadius: 10,
            padding: 6,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(15,23,42,0.65))",
            border: "1px solid rgba(255,255,255,0.20)",
            boxShadow: "0 0 10px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.9, marginBottom: 6 }}>
            Preview
          </div>

          <div
            style={{
              borderRadius: 8,
              overflow: "hidden",
              background: "#020617",
              height: 120, // ✅ shorter
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={data?.emailName || "Email preview"}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            ) : (
              <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.85, padding: 10 }}>
                No preview
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: STATS (only top 3) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <StatRow label="Processed" value={processed} />
          <StatRow label="Delivered" value={delivered} />
          <StatRow label="Opened" value={opened} />

          {/* Optional quick status line */}
          <div
            style={{
              marginTop: 4,
              fontSize: 16,
              fontWeight: 500,
              opacity: 0.9,
              padding: "6px 10px",
              borderRadius: 10,
              background: "rgba(2,6,23,0.18)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            {delivered > 0
              ? "✅ Sending working"
              : processed > 0
              ? "⏳ Processing"
              : "— No activity yet"}
          </div>
        </div>
      </div>

      {/* HANDLES */}
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
