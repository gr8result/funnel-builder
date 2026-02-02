// ============================================
// /components/email/builder/blocks/HeroBlock.js
// ============================================

export default function HeroBlock({ block, boxStyle }) {
  const fit = block.content?.fit || "cover";
  const fx = Number.isFinite(+block.content?.focalX) ? +block.content.focalX : 50;
  const fy = Number.isFinite(+block.content?.focalY) ? +block.content.focalY : 50;

  return (
    <div style={boxStyle}>
      {block.content?.image ? (
        <img
          src={block.content.image}
          alt=""
          style={{
            width: "100%",
            height: 320,
            objectFit: fit,
            objectPosition: `${fx}% ${fy}%`,
            borderRadius: 12,
            display: "block",
            marginBottom: 12,
          }}
        />
      ) : (
        <div style={{ border: "1px dashed rgba(255,255,255,.18)", borderRadius: 12, padding: 18, textAlign: "center", opacity: 0.85 }}>
          (No hero image selected)
        </div>
      )}

      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 10 }}>{block.content?.title || "Big headline"}</div>
      <div style={{ fontSize: 13, opacity: 0.9, marginTop: 8 }}>
        {block.content?.subtitle || "Write your main message here. Keep it clear and short."}
      </div>
    </div>
  );
}
