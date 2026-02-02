// components/email/builder/TextEditSidePanel.js
// ============================================
// GR8 RESULT — Text inspector panel (module)
// FULL REPLACEMENT
//
// ✅ Uses RichTextEditor + TextToolbar
// ✅ Stores blockStyle separately (align + lineHeight)
// ✅ No image library here (by design)
// ============================================

import { useMemo, useRef } from "react";
import RichTextEditor from "./RichTextEditor";
import TextToolbar from "./TextToolbar";

export default function TextEditSidePanel({ block, onChange }) {
  const editorRef = useRef(null);

  const blockStyle = useMemo(() => {
    return {
      textAlign: block?.style?.textAlign || block?.style?.align || "left",
      lineHeight: block?.style?.lineHeight || 1.6,
    };
  }, [block]);

  const setBlockStyle = (next) => {
    onChange?.({
      ...block,
      style: {
        ...(block.style || {}),
        textAlign: next.textAlign,
        lineHeight: next.lineHeight,
      },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "#22c55e" }}>Text tools</div>

      <TextToolbar
        editorRef={editorRef}
        blockStyle={blockStyle}
        onBlockStyleChange={setBlockStyle}
      />

      <div style={{ fontSize: 14, color: "#94a3b8" }}>
        Select text first to apply font / size / colour.
      </div>

      <RichTextEditor
        ref={editorRef}
        value={block?.html || "<div><br/></div>"}
        onChange={(html) => onChange?.({ ...block, html })}
        blockStyle={blockStyle}
      />
    </div>
  );
}
