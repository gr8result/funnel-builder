// components/email/builder/TextToolbar.js
// ============================================
// GR8 RESULT — TextToolbar (standalone module)
// FULL REPLACEMENT
//
// Requires: editorRef from RichTextEditor
// - editorRef.current.applyInlineStyle(...)
// - editorRef.current.applyBlockStyle(...)
// ============================================

import { useMemo, useState } from "react";

const FONT_OPTIONS = [
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Garamond",
  "Courier New",
  "Impact",
  "Comic Sans MS",
  "Segoe UI",
  "Roboto",
  "Inter",
  "Poppins",
  "Montserrat",
];

const SIZE_OPTIONS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72];

const COLOURS = [
  "#000000",
  "#111827",
  "#6b7280",
  "#2297c5",
  "#3b82f6",
  "#14b8a6",
  "#22c55e",
  "#facc15",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#ffffff",
];

export default function TextToolbar({
  editorRef,
  blockStyle,
  onBlockStyleChange,
}) {
  const [customSize, setCustomSize] = useState("");

  const lineHeights = useMemo(() => [1.2, 1.4, 1.6, 1.8, 2.0, 2.2], []);

  const applyInline = (patch) => {
    const ok = editorRef?.current?.applyInlineStyle?.(patch);
    if (!ok) {
      // selection missing
      // (no alert spam; user can see it not apply)
    } else {
      editorRef?.current?.focus?.();
    }
  };

  const applyBlock = (patch) => {
    onBlockStyleChange?.({ ...(blockStyle || {}), ...(patch || {}) });
    editorRef?.current?.applyBlockStyle?.(patch || {});
    editorRef?.current?.focus?.();
  };

  const pill = {
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "#111827",
    color: "#fff",
    padding: "10px 12px",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 900,
  };

  const select = {
    width: "100%",
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "#111827",
    color: "#fff",
    fontSize: 16,
    outline: "none",
  };

  const label = { fontSize: 14, fontWeight: 900, color: "#e5e7eb", marginBottom: 6 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Inline tools */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={pill} onClick={() => applyInline({ fontWeight: "700" })}>B</button>
        <button style={pill} onClick={() => applyInline({ fontStyle: "italic" })}>I</button>
        <button style={pill} onClick={() => applyInline({ textDecoration: "underline" })}>U</button>

        <button style={pill} onClick={() => applyBlock({ textAlign: "left" })}>⬅</button>
        <button style={pill} onClick={() => applyBlock({ textAlign: "center" })}>⬌</button>
        <button style={pill} onClick={() => applyBlock({ textAlign: "right" })}>➡</button>
      </div>

      {/* Font */}
      <div>
        <div style={label}>Font (selection)</div>
        <select
          style={select}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            applyInline({ fontFamily: v });
            e.target.value = "";
          }}
        >
          <option value="">Apply font to selection…</option>
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* Size */}
      <div>
        <div style={label}>Size (selection)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
          <select
            style={select}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const px = parseInt(v, 10);
              if (Number.isFinite(px)) applyInline({ fontSize: `${px}px` });
              e.target.value = "";
            }}
          >
            <option value="">Apply size to selection…</option>
            {SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}px</option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={customSize}
              onChange={(e) => setCustomSize(e.target.value)}
              placeholder="Custom px"
              style={{
                flex: 1,
                padding: "10px 10px",
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,0.25)",
                background: "#111827",
                color: "#fff",
                fontSize: 16,
                outline: "none",
              }}
            />
            <button
              style={pill}
              onClick={() => {
                const px = parseInt(customSize, 10);
                if (!Number.isFinite(px)) return;
                applyInline({ fontSize: `${px}px` });
              }}
              title="Apply custom size to selection"
            >
              ✓
            </button>
          </div>
        </div>
      </div>

      {/* Colour */}
      <div>
        <div style={label}>Colour (selection)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => applyInline({ color: c })}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.25)",
                background: c,
                cursor: "pointer",
              }}
              title={c}
            />
          ))}
        </div>
      </div>

      {/* Block style */}
      <div>
        <div style={label}>Line height (block)</div>
        <select
          style={select}
          value={String(blockStyle?.lineHeight || 1.6)}
          onChange={(e) => applyBlock({ lineHeight: parseFloat(e.target.value) })}
        >
          {lineHeights.map((lh) => (
            <option key={lh} value={lh}>{lh.toFixed(1)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
