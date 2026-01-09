import { v4 as uuid } from "uuid";

export default function LeftPanel({ addBlock }) {
  const blocks = [
    {
      label: "Text",
      create: () => ({
        id: uuid(),
        type: "text",
        tag: "p",
        content: "Edit text",
        styles: { fontSize: 16, color: "#000" },
      }),
    },
    {
      label: "Heading",
      create: () => ({
        id: uuid(),
        type: "text",
        tag: "h1",
        content: "Heading",
        styles: { fontSize: 42, fontWeight: 700 },
      }),
    },
    {
      label: "Image",
      create: () => ({
        id: uuid(),
        type: "image",
        src: "https://picsum.photos/800/400",
        styles: { width: "100%" },
      }),
    },
    {
      label: "Section",
      create: () => ({
        id: uuid(),
        type: "section",
        styles: { padding: 40, background: "#f8fafc" },
        children: [],
      }),
    },
  ];

  return (
    <div
      style={{
        width: 260,
        background: "#020617",
        color: "#fff",
        padding: 16,
      }}
    >
      <h3>Blocks</h3>
      {blocks.map((b) => (
        <div
          key={b.label}
          onClick={() => addBlock(b.create())}
          style={{
            background: "#2563eb",
            padding: 14,
            borderRadius: 8,
            marginBottom: 12,
            cursor: "pointer",
            textAlign: "center",
            fontWeight: 700,
          }}
        >
          {b.label}
        </div>
      ))}
    </div>
  );
}
