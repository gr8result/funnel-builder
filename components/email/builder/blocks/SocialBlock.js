// ============================================
// /components/email/builder/blocks/SocialBlock.js
// ============================================

export default function SocialBlock({ boxStyle }) {
  return (
    <div style={boxStyle}>
      <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
        {["Facebook", "Instagram", "LinkedIn", "YouTube"].map((n) => (
          <span key={n} style={{ color: "#60a5fa", fontWeight: 900 }}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}
