// ============================================
// /components/email/builder/ImageResizeHandle.js
// Drag handle to resize image width (%) inside email preview
// ============================================

import { useEffect, useRef, useState } from "react";

export default function ImageResizeHandle({ widthPercent, onChange }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    function onMove(e) {
      if (!dragging || !ref.current) return;

      const host = ref.current.parentElement; // container
      if (!host) return;

      const rect = host.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(10, Math.min(100, Math.round((x / rect.width) * 100)));

      onChange(pct);
    }

    function onUp() {
      if (dragging) setDragging(false);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, onChange]);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      style={{
        position: "absolute",
        right: -6,
        bottom: -6,
        width: 14,
        height: 14,
        borderRadius: 4,
        background: "#22c55e",
        border: "2px solid #ffffff",
        cursor: "nwse-resize",
        boxShadow: "0 6px 16px rgba(0,0,0,.35)",
        userSelect: "none",
      }}
      title={`Drag to resize (${widthPercent}%)`}
    />
  );
}
