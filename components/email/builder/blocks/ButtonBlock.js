// ============================================
// /components/email/builder/blocks/ButtonBlock.js
// ============================================

export default function ButtonBlock({ block, boxStyle, align }) {
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  return (
    <div style={boxStyle}>
      <div style={{ display: "flex", justifyContent: justify }}>
        <a
          href={block.content?.url || "#"}
          onClick={(e) => e.preventDefault()}
          style={{
            display: "inline-block",
            background: "#ef4444",
            color: "#fff",
            padding: "12px 18px",
            borderRadius: 10,
            fontWeight: 900,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          {block.content?.label || "Click here"}
        </a>
      </div>
    </div>
  );
}
