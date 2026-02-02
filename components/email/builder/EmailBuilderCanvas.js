// ============================================
// /components/email/builder/EmailBuilderCanvas.js
// FULL REPLACEMENT
// ✅ Wide white email preview
// ✅ Native drag & drop reorder
// ✅ Click to select
// ✅ Up/Down + Delete controls
// ============================================

import TextBlockView from "./blocks/TextBlockView";
import ImageBlockView from "./blocks/ImageBlockView";

export default function EmailBuilderCanvas({
  blocks,
  selectedId,
  onSelect,
  onChangeBlocks,
  onDelete,
  onMove,
  onUpdateBlock,
}) {
  const onDragStart = (e, id) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDrop = (e, overId) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain");
    if (!fromId || fromId === overId) return;

    const idxFrom = blocks.findIndex((b) => b.id === fromId);
    const idxOver = blocks.findIndex((b) => b.id === overId);
    if (idxFrom < 0 || idxOver < 0) return;

    const next = [...blocks];
    const [moved] = next.splice(idxFrom, 1);
    next.splice(idxOver, 0, moved);
    onChangeBlocks(next);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  return (
    <div
      style={{
        background: "#0b1120",
        borderRadius: 16,
        border: "1px solid rgba(148,163,184,0.18)",
        padding: 12,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 860, // wider editing canvas
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid rgba(15,23,42,0.15)",
          minHeight: 520,
        }}
      >
        {(blocks || []).map((b) => (
          <div
            key={b.id}
            draggable
            onDragStart={(e) => onDragStart(e, b.id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, b.id)}
            onClick={() => onSelect?.(b.id)}
            style={{
              outline: b.id === selectedId ? "3px solid #22c55e" : "1px solid rgba(15,23,42,0.06)",
              outlineOffset: -3,
              position: "relative",
              cursor: "pointer",
            }}
          >
            <TopControls
              selected={b.id === selectedId}
              onUp={() => onMove?.(b.id, "up")}
              onDown={() => onMove?.(b.id, "down")}
              onDelete={() => onDelete?.(b.id)}
            />

            <BlockRenderer block={b} onUpdate={onUpdateBlock} />
          </div>
        ))}

        {(!blocks || blocks.length === 0) && (
          <div style={{ padding: 18, color: "#111827", fontSize: 16 }}>
            No blocks yet. Add blocks on the left.
          </div>
        )}
      </div>
    </div>
  );
}

function TopControls({ selected, onUp, onDown, onDelete }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 10,
        top: 10,
        zIndex: 10,
        display: "flex",
        gap: 6,
        opacity: selected ? 1 : 0.25,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Btn onClick={onUp}>↑</Btn>
      <Btn onClick={onDown}>↓</Btn>
      <Btn danger onClick={onDelete}>Delete</Btn>
    </div>
  );
}

function Btn({ children, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 999,
        border: "none",
        background: danger ? "#ef4444" : "#111827",
        color: danger ? "#0b1120" : "#fff",
        padding: "8px 10px",
        fontSize: 14,
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function BlockRenderer({ block, onUpdate }) {
  const b = block;

  if (b.type === "text") {
    return (
      <TextBlockView
        block={b}
        onChange={(next) => onUpdate?.(b.id, next)}
      />
    );
  }

  if (b.type === "image") {
    return (
      <ImageBlockView
        block={b}
        onChange={(next) => onUpdate?.(b.id, next)}
      />
    );
  }

  // simple renderers
  if (b.type === "header") {
    const bg = b.data?.bg || "#3b82f6";
    const text = b.data?.text || "#ffffff";
    return (
      <div style={{ background: bg, padding: "22px 18px", textAlign: "center", color: text }}>
        <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.2 }}>{b.data?.title || ""}</div>
        <div style={{ fontSize: 16, opacity: 0.95 }}>{b.data?.subtitle || ""}</div>
      </div>
    );
  }

  if (b.type === "hero") {
    return (
      <div style={{ padding: 18, background: b.data?.bg || "#fff" }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: "#0b1120", marginBottom: 8 }}>
          {b.data?.headline || ""}
        </div>
        <div style={{ fontSize: 16, color: "#111827", lineHeight: 1.6 }}>
          {b.data?.sub || ""}
        </div>
      </div>
    );
  }

  if (b.type === "button") {
    return (
      <div style={{ padding: 18, textAlign: "center" }}>
        <div
          style={{
            display: "inline-block",
            background: b.data?.bg || "#22c55e",
            color: b.data?.color || "#0b1120",
            padding: "14px 18px",
            borderRadius: b.data?.radius ?? 999,
            fontWeight: 900,
          }}
        >
          {b.data?.label || "Click"}
        </div>
      </div>
    );
  }

  if (b.type === "divider") {
    return (
      <div style={{ padding: "10px 18px" }}>
        <div style={{ height: b.data?.thickness ?? 1, background: b.data?.color || "rgba(148,163,184,0.45)" }} />
      </div>
    );
  }

  if (b.type === "spacer") {
    return <div style={{ height: b.data?.height ?? 18 }} />;
  }

  if (b.type === "social") {
    return (
      <div style={{ padding: 18, textAlign: "center", color: "#111827" }}>
        {b.data?.text || "Follow us"}
      </div>
    );
  }

  if (b.type === "footer") {
    return (
      <div style={{ padding: 18, textAlign: "center", color: "#64748b", fontSize: 13 }}>
        {b.data?.text || ""}
      </div>
    );
  }

  return <div style={{ padding: 18 }} />;
}
