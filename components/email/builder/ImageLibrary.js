// ============================================
// /components/email/builder/ImageLibrary.js
// FULL REPLACEMENT
// ✅ Upload + Refresh
// ✅ Click image to insert (no URL typing)
// ============================================

import { useRef } from "react";

export default function ImageLibrary({ images, busy, onRefresh, onUpload, onPick }) {
  const fileRef = useRef(null);

  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid rgba(148,163,184,0.18)",
        padding: 12,
        background: "#0b1120",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 900, color: "#60a5fa", marginBottom: 8 }}>
        Image Library
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={pill("#22c55e")}
          disabled={busy}
        >
          + Upload
        </button>
        <button
          type="button"
          onClick={onRefresh}
          style={pill("#111827")}
          disabled={busy}
        >
          Refresh
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload?.(f);
          }}
        />
      </div>

      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>
        Click an image to insert into the selected Image block (or it will add a new Image block).
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 6 }}>
        {(!images || images.length === 0) && (
          <div style={{ fontSize: 14, color: "#94a3b8" }}>No images yet.</div>
        )}

        {images?.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {images.map((img) => (
              <button
                key={img.id || img.url}
                type="button"
                onClick={() => onPick?.(img.url)}
                style={{
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "#111827",
                  borderRadius: 12,
                  padding: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <img
                  src={img.url}
                  alt={img.name || ""}
                  style={{
                    width: "100%",
                    height: 88,
                    objectFit: "cover",
                    borderRadius: 10,
                    display: "block",
                    background: "#0b1120",
                  }}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: "#cbd5e1",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {img.name || "image"}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function pill(bg) {
  return {
    border: "none",
    background: bg,
    color: "#0b1120",
    borderRadius: 999,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  };
}
