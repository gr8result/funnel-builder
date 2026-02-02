// ============================================
// /components/email/builder/blocks/DividerBlock.js
// ============================================

export default function DividerBlock({ block, boxStyle }) {
  const t = Number.isFinite(+block.content?.thickness) ? +block.content.thickness : 1;
  return (
    <div style={boxStyle}>
      <div style={{ height: t, background: "rgba(255,255,255,.18)", borderRadius: 999 }} />
    </div>
  );
}
