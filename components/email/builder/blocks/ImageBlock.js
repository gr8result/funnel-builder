// ============================================
// /components/email/builder/blocks/ImageBlock.js
// ============================================

export default function ImageBlock({ block, boxStyle }) {
  const fit = block.content?.fit || "cover";
  const fx = Number.isFinite(+block.content?.focalX) ? +block.content.focalX : 50;
  const fy = Number.isFinite(+block.content?.focalY) ? +block.content.focalY : 50;

  return (
    <div style={boxStyle}>
      {block.content?.image ? (
        <img
          src={block.content.image}
          alt={block.content?.alt || ""}
          style={{
            width: "100%",
            height: 360,
            objectFit: fit,
            objectPosition: `${fx}% ${fy}%`,
            borderRadius: 12,
            display: "block",
          }}
        />
      ) : (
        <div style={{ border: "1px dashed rgba(255,255,255,.18)", borderRadius: 12, padding: 18, textAlign: "center", opacity: 0.85 }}>
          Click an image in the library to insert
        </div>
      )}
    </div>
  );
}
