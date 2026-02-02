// components/website-builder/blocks/BlockRenderer.js
// ✅ NEW FILE (minimal stub to satisfy build)
// Replace later with your real website builder block renderer.

export default function BlockRenderer({ block }) {
  return (
    <div
      style={{
        border: "1px dashed #cbd5e1",
        borderRadius: 12,
        padding: 12,
        fontSize: 16,
        background: "#fff",
        color: "#111",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Block Renderer Stub</div>
      <div style={{ opacity: 0.8 }}>
        This is a placeholder so builds succeed.
      </div>
      <pre
        style={{
          marginTop: 10,
          padding: 10,
          background: "#f8fafc",
          borderRadius: 10,
          overflow: "auto",
          fontSize: 12,
        }}
      >
        {JSON.stringify(block || {}, null, 2)}
      </pre>
    </div>
  );
}



