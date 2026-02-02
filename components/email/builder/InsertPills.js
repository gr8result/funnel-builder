// ============================================
// /components/email/builder/InsertPills.js
// ============================================

export default function InsertPills({ onInsert, styles }) {
  const types = ["header", "hero", "text", "image", "button", "social", "divider", "spacer", "footer"];

  return (
    <div style={styles.pillRow}>
      {types.map((t) => (
        <button key={t} style={styles.pill} onClick={() => onInsert(t)}>
          + {t}
        </button>
      ))}
    </div>
  );
}
