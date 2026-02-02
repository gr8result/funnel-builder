// ============================================
// /components/email/builder/blocks/FooterBlock.js
// ============================================

export default function FooterBlock({ block, boxStyle }) {
  return (
    <div style={boxStyle}>
      <div style={{ fontSize: 12, opacity: 0.85, textAlign: "center" }}>
        {block.content?.text || "© GR8 RESULT — All rights reserved."}
      </div>
    </div>
  );
}
