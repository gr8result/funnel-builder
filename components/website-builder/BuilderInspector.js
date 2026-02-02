// components/website-builder/BuilderInspector.js
// ✅ BUILD-STUB — allows main branch to compile
// Replace later with real inspector panel

export default function BuilderInspector() {
  return (
    <div
      style={{
        width: 320,
        minWidth: 320,
        borderLeft: "1px solid #e5e7eb",
        padding: 14,
        background: "#f9fafb",
        fontSize: 16,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        Inspector
      </div>

      <div style={{ opacity: 0.75, lineHeight: 1.4 }}>
        Inspector placeholder.
        <br />
        Settings will appear here once builder logic is restored.
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>
        Debug: BUILDER-INSPECTOR-STUB
      </div>
    </div>
  );
}
