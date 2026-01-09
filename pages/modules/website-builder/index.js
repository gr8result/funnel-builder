import { useMemo, useState } from "react";
import Head from "next/head";
import BlockRenderer from "../../../components/website-builder/blocks/BlockRenderer";
import BuilderLeftPanel from "../../../components/website-builder/BuilderLeftPanel";
import BuilderInspector from "../../../components/website-builder/BuilderInspector";

function uid() {
  return `b_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const DEFAULT_PAGE = {
  theme: {
    accent: "#2297c5",
    maxWidth: 1440,
  },
  blocks: [],
};

export default function WebsiteBuilderPage() {
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [selectedId, setSelectedId] = useState(null);

  const blocks = page?.blocks || [];
  const theme = page?.theme || {};

  const selectedBlock = useMemo(() => {
    if (!selectedId) return null;
    return blocks.find((b) => b?.id === selectedId) || null;
  }, [blocks, selectedId]);

  function addBlock(def) {
    const block = {
      id: uid(),
      preset: def?.preset || def?.type || "block",
      type: def?.type || "text",
      props: def?.props || {},
      textStyle: def?.textStyle || {},
      background: def?.background || "transparent",
      ...def,
    };

    setPage((p) => ({
      ...p,
      blocks: [...(p?.blocks || []), block],
    }));
    setSelectedId(block.id);
  }

  function updateTheme(patch) {
    setPage((p) => ({
      ...p,
      theme: { ...(p?.theme || {}), ...(patch || {}) },
    }));
  }

  function updateBlock(id, patch) {
    if (!id) return;
    setPage((p) => ({
      ...p,
      blocks: (p?.blocks || []).map((b) =>
        b?.id === id ? { ...b, ...(patch || {}) } : b
      ),
    }));
  }

  function updateSelectedBlockProps(patch) {
    if (!selectedId) return;
    const cur = blocks.find((b) => b?.id === selectedId);
    updateBlock(selectedId, { props: { ...(cur?.props || {}), ...(patch || {}) } });
  }

  function deleteSelected() {
    if (!selectedId) return;
    setPage((p) => ({
      ...p,
      blocks: (p?.blocks || []).filter((b) => b?.id !== selectedId),
    }));
    setSelectedId(null);
  }

  function onCanvasMouseDown(e) {
    // click empty canvas -> deselect
    const hit = e.target?.getAttribute?.("data-hit");
    if (hit === "canvas") setSelectedId(null);
  }

  const maxWidth = Number(theme.maxWidth || 1440) || 1440;

  return (
    <>
      <Head>
        <title>Website Builder</title>
      </Head>

      {/* STANDARD BANNER */}
      <div style={banner.wrap}>
        <div style={banner.left}>
          <div style={banner.icon}>🌐</div>
          <div>
            <div style={banner.title}>Website Builder</div>
            <div style={banner.subTitle}>Build pages with drag & drop blocks</div>
          </div>
        </div>

        <button
          style={banner.backBtn}
          onClick={() => (window.location.href = "/dashboard")}
        >
          ← Back
        </button>
      </div>

      {/* LAYOUT */}
      <div style={layout.shell}>
        {/* LEFT */}
        <div style={layout.left}>
          <BuilderLeftPanel onAdd={addBlock} />
        </div>

        {/* CANVAS */}
        <div style={layout.middle}>
          <div style={layout.middleInner}>
            <div
              data-hit="canvas"
              onMouseDown={onCanvasMouseDown}
              style={{
                ...canvas.page,
                maxWidth,
              }}
            >
              {blocks.length === 0 ? (
                <div style={canvas.empty}>
                  Drop blocks here (or click blocks on the left to add)
                </div>
              ) : (
                blocks.map((b) => {
                  const isSelected = b?.id === selectedId;
                  const resolvedBackground =
                    b?.props?.background ??
                    b?.background ??
                    "transparent";

                  return (
                    <div
                      key={b.id}
                      style={{
                        ...canvas.blockShell,
                        outline: isSelected ? "2px solid rgba(34,151,197,0.85)" : "2px solid transparent",
                        boxShadow: isSelected
                          ? "0 0 0 6px rgba(34,151,197,0.12)"
                          : "none",
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedId(b.id);
                      }}
                    >
                      <BlockRenderer
                        block={b}
                        theme={theme}
                        resolvedBackground={resolvedBackground}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={layout.right}>
          <BuilderInspector
            page={page}
            selectedBlock={selectedBlock}
            onUpdateTheme={updateTheme}
            onUpdateBlockProps={updateSelectedBlockProps}
            onDeleteSelected={deleteSelected}
          />
        </div>
      </div>
    </>
  );
}

const banner = {
  wrap: {
    height: 92,
    background: "#0f172a",
    color: "white",
    display: "flex",
    alignItems: "center",
    padding: "0 20px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  left: { display: "flex", alignItems: "center", gap: 14 },
  icon: { fontSize: 48, lineHeight: 1 },
  title: { fontSize: 48, fontWeight: 700, lineHeight: 1 },
  subTitle: { fontSize: 18, fontWeight: 500, opacity: 0.8, marginTop: 4 },
  backBtn: {
    marginLeft: "auto",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    padding: "10px 16px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
};

const layout = {
  shell: {
    display: "grid",
    gridTemplateColumns: "320px 1fr 340px",
    height: "calc(100vh - 92px)",
    background: "#020617",
  },
  left: {
    padding: 14,
    borderRight: "1px solid rgba(255,255,255,0.08)",
    overflow: "auto",
  },
  middle: {
    overflow: "auto",
    background: "#0b1220",
  },
  middleInner: {
    padding: 26,
    minHeight: "100%",
  },
  right: {
    padding: 14,
    borderLeft: "1px solid rgba(255,255,255,0.08)",
    overflow: "auto",
  },
};

const canvas = {
  page: {
    margin: "0 auto",
    background: "#ffffff",
    borderRadius: 16,
    minHeight: "78vh",
    padding: 18,
    border: "1px solid rgba(0,0,0,0.08)",
  },
  empty: {
    padding: 80,
    textAlign: "center",
    color: "#94a3b8",
    fontWeight: 800,
  },
  blockShell: {
    borderRadius: 14,
    padding: 8,
    marginBottom: 14,
    transition: "outline 120ms ease, box-shadow 120ms ease",
    cursor: "pointer",
  },
};
