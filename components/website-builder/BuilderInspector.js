export default function BuilderInspector({
  page,
  selectedBlock,
  onUpdateTheme,
  onUpdateBlockProps,
  onDeleteSelected,
}) {
  const theme = page?.theme || {};
  const p = selectedBlock?.props || null;

  return (
    <aside style={styles.aside}>
      <div style={styles.header}>
        <div style={styles.title}>Inspector</div>
        <div style={styles.sub}>
          {selectedBlock ? `Selected: ${selectedBlock.preset}` : "Select a block"}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Theme</div>

        <label style={styles.label}>Accent</label>
        <input
          value={theme.accent || ""}
          onChange={(e) => onUpdateTheme({ accent: e.target.value })}
          style={styles.input}
          placeholder="#2297c5"
        />

        <label style={styles.label}>Max width</label>
        <input
          type="number"
          value={Number(theme.maxWidth || 1440)}
          onChange={(e) =>
            onUpdateTheme({ maxWidth: Number(e.target.value || 1440) })
          }
          style={styles.input}
        />
      </div>

      <div style={styles.divider} />

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Block</div>

        {!selectedBlock ? (
          <div style={styles.muted}>Click a block in the canvas to edit it.</div>
        ) : (
          <>
            <label style={styles.label}>Padding Y</label>
            <input
              type="number"
              value={Number(p?.paddingY ?? 48)}
              onChange={(e) =>
                onUpdateBlockProps({ paddingY: Number(e.target.value || 0) })
              }
              style={styles.input}
            />

            <label style={styles.label}>Padding X</label>
            <input
              type="number"
              value={Number(p?.paddingX ?? 20)}
              onChange={(e) =>
                onUpdateBlockProps({ paddingX: Number(e.target.value || 0) })
              }
              style={styles.input}
            />

            <label style={styles.label}>Radius</label>
            <input
              type="number"
              value={Number(p?.radius ?? 14)}
              onChange={(e) =>
                onUpdateBlockProps({ radius: Number(e.target.value || 0) })
              }
              style={styles.input}
            />

            <label style={styles.label}>Background</label>
            <input
              value={String(p?.background ?? "transparent")}
              onChange={(e) => onUpdateBlockProps({ background: e.target.value })}
              style={styles.input}
              placeholder="transparent / rgba(...) / #..."
            />

            <label style={styles.label}>Align</label>
            <select
              value={p?.align || "left"}
              onChange={(e) => onUpdateBlockProps({ align: e.target.value })}
              style={styles.select}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
            </select>

            <div style={{ height: 10 }} />

            <button style={styles.dangerBtn} onClick={onDeleteSelected}>
              Delete selected block
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

const styles = {
  aside: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    overflow: "hidden",
    minHeight: "78vh",
  },
  header: {
    padding: 12,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.12)",
  },
  title: { color: "white", fontWeight: 900, fontSize: 16 },
  sub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },

  section: { padding: 12 },
  sectionTitle: {
    color: "white",
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 10,
  },
  label: {
    display: "block",
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    fontWeight: 800,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "white",
    padding: "10px 12px",
    fontSize: 13,
    outline: "none",
  },
  select: {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "white",
    padding: "10px 12px",
    fontSize: 13,
    outline: "none",
  },
  muted: { color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 1.5 },
  divider: { height: 1, background: "rgba(255,255,255,0.08)" },
  dangerBtn: {
    width: "100%",
    background: "rgba(244,63,94,0.15)",
    border: "1px solid rgba(244,63,94,0.35)",
    color: "white",
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  },
};
