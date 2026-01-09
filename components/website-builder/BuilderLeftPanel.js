export default function BuilderLeftPanel({ onAdd }) {
  return (
    <div>
      <div style={styles.title}>Blocks</div>

      <Category title="Backgrounds">
        <BlockButton
          label="Section (Light)"
          color="#2563eb"
          onClick={() =>
            onAdd({
              preset: "section",
              type: "text",
              textStyle: { fontSize: 16, weight: 800 },
              props: {
                background: "#f8fafc",
                paddingY: 48,
                paddingX: 20,
                radius: 14,
                align: "left",
              },
            })
          }
        />
        <BlockButton
          label="Section (Dark)"
          color="#7c3aed"
          onClick={() =>
            onAdd({
              preset: "section",
              type: "text",
              textStyle: { color: "#ffffff", fontSize: 16, weight: 800 },
              props: {
                background: "rgba(0,0,0,0.30)",
                paddingY: 48,
                paddingX: 20,
                radius: 14,
                align: "left",
              },
            })
          }
        />
      </Category>

      <Category title="Text">
        <BlockButton
          label="Heading (H1)"
          color="#059669"
          onClick={() =>
            onAdd({
              preset: "text",
              type: "text",
              textStyle: { fontSize: 48, weight: 950, align: "left" },
              props: { paddingY: 28, paddingX: 0, radius: 0, background: "transparent", align: "left" },
              // TextBlock should read something from block (your TextBlock decides this)
              heading: "Your heading",
              content: "Your heading",
              text: "Your heading",
            })
          }
        />
        <BlockButton
          label="Paragraph"
          color="#f59e0b"
          onClick={() =>
            onAdd({
              preset: "text",
              type: "text",
              textStyle: { fontSize: 18, weight: 750, align: "left" },
              props: { paddingY: 14, paddingX: 0, radius: 0, background: "transparent", align: "left" },
              content:
                "This is paragraph text. Select the block, then use the Inspector to adjust padding/background/align.",
              text:
                "This is paragraph text. Select the block, then use the Inspector to adjust padding/background/align.",
            })
          }
        />
      </Category>

      <Category title="Layout">
        <BlockButton
          label="Two Column"
          color="#dc2626"
          onClick={() =>
            onAdd({
              preset: "two_col",
              type: "two_col",
              textStyle: { fontSize: 16, weight: 800 },
              props: { paddingY: 48, paddingX: 20, radius: 14, background: "transparent", align: "left" },
              heading: "Two column section",
              left: {
                title: "Left title",
                text: "Left text…",
                bullets: ["Point one", "Point two", "Point three"],
              },
              right: { image: "", caption: "Caption" },
              reverse: false,
            })
          }
        />
        <BlockButton
          label="Three Column"
          color="#0ea5e9"
          onClick={() =>
            onAdd({
              preset: "three_col",
              type: "three_col",
              textStyle: { fontSize: 16, weight: 800 },
              props: { paddingY: 48, paddingX: 20, radius: 14, background: "transparent", align: "left" },
              heading: "Three column section",
              columns: [
                { title: "Column 1", text: "Text…" },
                { title: "Column 2", text: "Text…" },
                { title: "Column 3", text: "Text…" },
              ],
            })
          }
        />
      </Category>

      <Category title="Images">
        <BlockButton
          label="Image"
          color="#22c55e"
          onClick={() =>
            onAdd({
              preset: "image",
              type: "image",
              textStyle: {},
              props: { paddingY: 24, paddingX: 0, radius: 14, background: "transparent", align: "left" },
              src: "https://picsum.photos/1200/600",
            })
          }
        />
        <BlockButton
          label="Gallery"
          color="#e879f9"
          onClick={() =>
            onAdd({
              preset: "gallery",
              type: "gallery",
              textStyle: { fontSize: 16, weight: 800 },
              props: { paddingY: 48, paddingX: 20, radius: 14, background: "transparent", align: "left" },
              heading: "Gallery",
              images: [
                "https://picsum.photos/400/300?1",
                "https://picsum.photos/400/300?2",
                "https://picsum.photos/400/300?3",
                "",
                "",
                "",
              ],
            })
          }
        />
      </Category>
    </div>
  );
}

function Category({ title, children }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.grid}>{children}</div>
    </div>
  );
}

function BlockButton({ label, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.btn,
        background: color,
      }}
    >
      {label}
    </button>
  );
}

const styles = {
  title: {
    color: "white",
    fontSize: 18,
    fontWeight: 950,
    marginBottom: 12,
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  cardTitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 10,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  btn: {
    border: "none",
    borderRadius: 12,
    padding: "14px 10px",
    color: "white",
    fontWeight: 950,
    cursor: "pointer",
    fontSize: 13,
  },
};
