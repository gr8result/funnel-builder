// ============================================
// /components/email/builder/blocks/SpacerBlock.js
// ============================================

export default function SpacerBlock({ block }) {
  const h = Number.isFinite(+block.content?.height) ? +block.content.height : 24;
  return <div style={{ height: h }} />;
}
