// ============================================
// /components/email/builder/BlockShell.js
// Wraps every block with header/actions + drag/drop
// ============================================

export default function BlockShell({
  block,
  isSelected,
  styles,
  onSelect,
  onDuplicate,
  onDelete,
  draggableProps = {},
  children,
}) {
  return (
    <div
      style={{ ...styles.blockWrap, ...(isSelected ? styles.selectedOutline : null) }}
      onClick={onSelect}
      {...draggableProps}
    >
      <div style={styles.blockTop}>
        <div style={styles.blockName}>
          <div style={styles.handle} title="Drag to reorder">
            ::
          </div>
          {String(block.type || "").toUpperCase()}
        </div>

        <div style={styles.blockActions}>
          <button style={styles.small} onClick={(e) => (e.stopPropagation(), onDuplicate())}>
            + same
          </button>
          <button style={styles.danger} onClick={(e) => (e.stopPropagation(), onDelete())}>
            Delete
          </button>
        </div>
      </div>

      <div style={styles.blockBody}>{children}</div>
    </div>
  );
}
