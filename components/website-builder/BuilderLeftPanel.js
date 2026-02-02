// components/website-builder/BuilderLeftPanel.js
// ✅ BUILD-STUB — allows main branch to compile
// Replace later with real website builder left panel

export default function BuilderLeftPanel() {
  return (
    <div
      style={{
        width: 300,
        minWidth: 300,
        borderRight: "1px solid #e5e7eb",
        padding: 14,
        background: "#f9fafb",
        fontSize: 16,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        Website Builder
      </div>

      <div style={{ opacity: 0.75, lineHeight: 1.4 }}>
        Left panel placeholder.
        <br />
        Blocks / elements will appear here once builder is restored.
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>
        Debug: BUILDER-LEFT-STUB
      </div>
    </div>
  );
}


