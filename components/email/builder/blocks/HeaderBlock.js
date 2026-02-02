// ============================================
// /components/email/builder/blocks/HeaderBlock.js
// ============================================

export default function HeaderBlock({ block, boxStyle }) {
  return (
    <div style={boxStyle}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{block.content?.title || "GR8 RESULT"}</div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>{block.content?.subtitle || ""}</div>
      </div>
    </div>
  );
}
