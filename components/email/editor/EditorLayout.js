// /components/email/editor/EditorLayout.js
// FULL REPLACEMENT —
// ✅ FIX: Blocks drop where you release (not all to top) using pointer-based insertion (before/after hovered block)
// ✅ Image block now selectable: clicking an image switches RIGHT panel to Image Tools (Text Tools closes)
// ✅ Image Tools: set/replace image src, open User Library (/api/email/editor-images), upload, and “Stock website images” (picsum)
// ✅ Adds File menu (Save / Save As / Open) with Save As showing existing file names to avoid overwrites
//
// Notes:
// - Saves are stored in localStorage (gr8:email:docs:v1) unless you wire to backend later.
// - Stock images uses https://picsum.photos (random safe website-style photos).

import { useEffect, useMemo, useRef, useState } from "react";
import RichTextToolbar from "./RichTextToolbar";
import { makeBlock } from "./blocks";

const PRESETS = [900, 1200, 1320, 1440];

const GRADIENTS = [
  { name: "Blue fade", value: "linear-gradient(180deg, #dbeafe 0%, #ffffff 55%, #ffffff 100%)" },
  { name: "Warm", value: "linear-gradient(135deg, #fff7ed 0%, #ffffff 60%, #ffffff 100%)" },
  { name: "Mint", value: "linear-gradient(135deg, #ecfeff 0%, #ffffff 60%, #ffffff 100%)" },
  { name: "Lavender", value: "linear-gradient(135deg, #f5f3ff 0%, #ffffff 60%, #ffffff 100%)" },
  { name: "Dark vignette", value: "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.18), rgba(0,0,0,0.35))" },
];

const LS_DOCS_KEY = "gr8:email:docs:v1";

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
  return Math.max(a, Math.min(b, x));
}
function safeStr(v) {
  return String(v || "");
}
function uid() {
  return `b_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function loadDocs() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_DOCS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
function saveDocs(obj) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_DOCS_KEY, JSON.stringify(obj || {}));
}

function makePicsumIds(count = 18) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    // “nice” range of ids; not perfect but works well visually
    ids.push(10 + Math.floor(Math.random() * 950));
  }
  return Array.from(new Set(ids)).slice(0, count);
}

export default function EditorLayout({ userId = "", initialHtml = "" }) {
  const editorRef = useRef(null);
  const dropLineRef = useRef(null);
  const lastRangeRef = useRef(null);

  const [leftTab, setLeftTab] = useState("blocks"); // blocks | background

  const [mode, setMode] = useState("1320"); // "900" | "1200" | "1320" | "1440" | "custom"
  const [customWidth, setCustomWidth] = useState(1320);

  const [bgType, setBgType] = useState("solid"); // solid | gradient | image
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgGradient, setBgGradient] = useState(GRADIENTS[0].value);

  const [bgImageUrl, setBgImageUrl] = useState("");
  const [bgImageFit, setBgImageFit] = useState("cover"); // cover | contain | repeat

  const [status, setStatus] = useState("Ready");

  // images
  const [imageUrls, setImageUrls] = useState([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploading, setUploading] = useState(false);

  // selection
  const [activeBlockId, setActiveBlockId] = useState("");
  const [isTextActive, setIsTextActive] = useState(false);

  const [activeImageId, setActiveImageId] = useState("");
  const isImageActive = !!activeImageId;

  // file menu
  const [fileOpen, setFileOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [currentDocName, setCurrentDocName] = useState("");
  const [saveAsName, setSaveAsName] = useState("");
  const [docs, setDocs] = useState({});
  const docNames = useMemo(() => Object.keys(docs || {}).sort((a, b) => a.localeCompare(b)), [docs]);

  // image tools panel state
  const [imgTab, setImgTab] = useState("library"); // library | stock
  const [stockIds, setStockIds] = useState(() => makePicsumIds(18));

  const canvasWidth =
    mode === "custom" ? clamp(customWidth, 320, 2400) : clamp(Number(mode), 320, 2400);

  const STANDARD_COLOURS = useMemo(
    () => [
      "#ffffff",
      "#f8fafc",
      "#f1f5f9",
      "#e2e8f0",
      "#cbd5e1",
      "#94a3b8",
      "#64748b",
      "#475569",
      "#334155",
      "#1f2937",
      "#111827",
      "#0b1120",
      "#eff6ff",
      "#dbeafe",
      "#bfdbfe",
      "#93c5fd",
      "#60a5fa",
      "#3b82f6",
      "#2563eb",
      "#1d4ed8",
      "#1e40af",
      "#172554",
      "#ecfeff",
      "#cffafe",
      "#99f6e4",
      "#5eead4",
      "#2dd4bf",
      "#14b8a6",
      "#0d9488",
      "#22c55e",
      "#16a34a",
      "#14532d",
      "#fefce8",
      "#fef9c3",
      "#fde68a",
      "#facc15",
      "#eab308",
      "#fed7aa",
      "#fb923c",
      "#f97316",
      "#c2410c",
      "#fef2f2",
      "#fecaca",
      "#fca5a5",
      "#ef4444",
      "#b91c1c",
      "#fce7f3",
      "#fbcfe8",
      "#f472b6",
      "#ec4899",
      "#9d174d",
      "#f5f3ff",
      "#ddd6fe",
      "#a78bfa",
      "#8b5cf6",
      "#6d28d9",
    ],
    []
  );

  // ---------- boot: load initialHtml into canvas ----------
  useEffect(() => {
    const canvas = editorRef.current;
    if (!canvas) return;

    const html = safeStr(initialHtml).trim();
    if (html) {
      canvas.innerHTML = html;
      normalizeCanvas(canvas);
      setStatus("Template loaded");
    } else {
      canvas.innerHTML = "";
      setStatus("Blank canvas");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  // ---------- boot docs ----------
  useEffect(() => {
    setDocs(loadDocs());
  }, []);

  // ---------- selection tracking (text) ----------
  useEffect(() => {
    function onSelChange() {
      try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
          setIsTextActive(false);
          return;
        }
        const r = sel.getRangeAt(0);
        const canvas = editorRef.current;
        if (!canvas || !canvas.contains(r.commonAncestorContainer)) {
          setIsTextActive(false);
          return;
        }
        const node =
          r.commonAncestorContainer.nodeType === 1
            ? r.commonAncestorContainer
            : r.commonAncestorContainer.parentElement;
        const textEl = node?.closest?.('[data-gr8-text="1"]');
        setIsTextActive(!!textEl);
      } catch {
        setIsTextActive(false);
      }
    }

    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, []);

  function rememberSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (editorRef.current && editorRef.current.contains(r.commonAncestorContainer)) {
        lastRangeRef.current = r.cloneRange();
      }
    } catch {}
  }
  function restoreSelection() {
    const r = lastRangeRef.current;
    if (!r) return false;
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Background style ----------
  function canvasFrameStyle() {
    if (bgType === "gradient") {
      return {
        backgroundImage: bgGradient,
        backgroundColor: "#ffffff",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    if (bgType === "image") {
      const repeat = bgImageFit === "repeat" ? "repeat" : "no-repeat";
      const size =
        bgImageFit === "contain" ? "contain" : bgImageFit === "repeat" ? "auto" : "cover";
      return {
        backgroundColor: bgColor || "#ffffff",
        backgroundImage: bgImageUrl ? `url("${bgImageUrl}")` : "none",
        backgroundRepeat: repeat,
        backgroundSize: size,
        backgroundPosition: "center",
      };
    }
    return { backgroundColor: bgColor || "#ffffff" };
  }

  // ---------- image library + upload ----------
  async function refreshImages() {
    if (!userId) return;
    setLoadingImages(true);
    try {
      const r = await fetch(`/api/email/editor-images?userId=${encodeURIComponent(userId)}`);
      const j = await r.json().catch(() => null);
      if (j?.ok && Array.isArray(j.urls)) setImageUrls(j.urls);
      else setImageUrls([]);
    } catch {
      setImageUrls([]);
    } finally {
      setLoadingImages(false);
    }
  }

  useEffect(() => {
    if ((leftTab === "background" && bgType === "image") || (isImageActive && imgTab === "library")) {
      refreshImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftTab, bgType, userId, isImageActive, imgTab]);

  async function onUploadImage(file, { setAsBackground, setAsBlockImage } = { setAsBackground: false, setAsBlockImage: true }) {
    if (!userId || !file) return;
    setUploading(true);
    try {
      const base64 = await readFileAsDataUrl(file);
      const r = await fetch(`/api/email/editor-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, filename: file.name, base64 }),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok && j?.url) {
        if (setAsBackground) setBgImageUrl(j.url);
        if (setAsBlockImage) setActiveImageSrc(j.url);
        setStatus("Image uploaded");
        await refreshImages();
      } else {
        setStatus("Image upload failed");
      }
    } catch {
      setStatus("Image upload failed");
    } finally {
      setUploading(false);
    }
  }

  function getActiveImageEl() {
    const canvas = editorRef.current;
    if (!canvas || !activeImageId) return null;
    return canvas.querySelector(`[data-gr8-img-id="${activeImageId}"]`);
  }
  function setActiveImageSrc(url) {
    const img = getActiveImageEl();
    if (!img) return;
    img.setAttribute("src", url);
    setStatus("Image updated");
  }
  function removeActiveImage() {
    const img = getActiveImageEl();
    if (!img) return;
    img.removeAttribute("src");
    setStatus("Image cleared");
  }

  // ---------- blocks: drag/drop (FIXED INSERTION) ----------
  function onDragStart(e, type) {
    e.dataTransfer.setData("gr8/block", type);
    e.dataTransfer.effectAllowed = "copy";
  }

  function findDropTarget(canvas, clientX, clientY) {
    if (!canvas) return null;

    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !canvas.contains(el)) return null;

    // if hovering a block, insert before/after based on midpoint
    const block = el.closest?.("[data-gr8-block='1']");
    if (block && canvas.contains(block)) {
      const r = block.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const before = clientY < mid;
      return { ref: block, before, lineY: before ? r.top : r.bottom };
    }

    // otherwise append at end, show line at bottom of canvas content
    const cr = canvas.getBoundingClientRect();
    return { ref: null, before: false, lineY: Math.min(clientY, cr.bottom) };
  }

  function onDragOver(e) {
    e.preventDefault();
    const canvas = editorRef.current;
    const line = dropLineRef.current;
    if (!canvas || !line) return;

    const ins = findDropTarget(canvas, e.clientX, e.clientY);
    if (!ins) {
      line.style.display = "none";
      return;
    }

    const outer = canvas.closest(".canvasOuter");
    const outerRect = outer?.getBoundingClientRect?.();
    const topOffset = outerRect ? outerRect.top : 0;

    line.style.display = "block";
    // convert viewport y to canvasOuter local y (so line stays in the right place when scrolling)
    line.style.top = `${ins.lineY - topOffset + (outer?.scrollTop || 0)}px`;
  }

  function onDrop(e) {
    e.preventDefault();
    const canvas = editorRef.current;
    const line = dropLineRef.current;
    if (line) line.style.display = "none";
    if (!canvas) return;

    const type = e.dataTransfer.getData("gr8/block");
    if (!type) return;

    const ins = findDropTarget(canvas, e.clientX, e.clientY);
    const blockEl = buildWrappedBlock(type);

    if (ins?.ref) {
      canvas.insertBefore(blockEl, ins.before ? ins.ref : ins.ref.nextSibling);
    } else {
      // IMPORTANT: default is APPEND (not top)
      canvas.appendChild(blockEl);
    }

    setStatus(`Added ${type}`);
  }

  function buildWrappedBlock(type) {
    const wrapper = document.createElement("div");
    wrapper.className = "gr8Block";
    const id = uid();
    wrapper.setAttribute("data-gr8-block", "1");
    wrapper.setAttribute("data-gr8-id", id);
    wrapper.contentEditable = "false";

    const body = document.createElement("div");
    body.className = "gr8Body";

    const inner = makeBlock(type);
    markTextZones(inner);
    markImageZones(inner);

    body.appendChild(inner);
    wrapper.appendChild(body);

    wrapper.addEventListener("mousedown", (ev) => {
      // don't steal selection when clicking inside text or image zone
      const t = ev.target?.closest?.('[data-gr8-text="1"]');
      const img = ev.target?.closest?.('[data-gr8-img="1"]');
      if (!t && !img) {
        ev.preventDefault();
        setActiveBlockId(id);
        setActiveImageId("");
        setIsTextActive(false);
      }
    });

    return wrapper;
  }

  function markTextZones(root) {
    const nodes = root.querySelectorAll?.("h1,h2,h3,h4,h5,h6,p,span,li,a,div");
    nodes?.forEach?.((n) => {
      if (n.querySelector && n.querySelector("[data-gr8-block]")) return;
      const txt = safeStr(n.textContent).trim();
      if (!txt) return;
      n.setAttribute("data-gr8-text", "1");
      n.contentEditable = "true";
      n.style.outline = "none";
    });
  }

  function markImageZones(root) {
    const imgs = root.querySelectorAll?.("img");
    imgs?.forEach?.((img) => {
      img.setAttribute("data-gr8-img", "1");
      if (!img.getAttribute("data-gr8-img-id")) img.setAttribute("data-gr8-img-id", uid());
      img.style.cursor = "pointer";
      // keep email-safe width by default
      if (!img.style.maxWidth) img.style.maxWidth = "100%";
      if (!img.style.display) img.style.display = "block";
    });
  }

  function normalizeCanvas(canvas) {
    const kids = Array.from(canvas.childNodes || []);
    kids.forEach((node) => {
      if (node.nodeType !== 1) return;
      const el = node;
      if (el.getAttribute?.("data-gr8-block") === "1") {
        // still ensure images are marked if existing
        markImageZones(el);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "gr8Block";
      const id = uid();
      wrap.setAttribute("data-gr8-block", "1");
      wrap.setAttribute("data-gr8-id", id);
      wrap.contentEditable = "false";

      const body = document.createElement("div");
      body.className = "gr8Body";

      body.appendChild(el.cloneNode(true));
      wrap.appendChild(body);
      el.replaceWith(wrap);

      markTextZones(wrap);
      markImageZones(wrap);

      wrap.addEventListener("mousedown", (ev) => {
        const t = ev.target?.closest?.('[data-gr8-text="1"]');
        const img = ev.target?.closest?.('[data-gr8-img="1"]');
        if (!t && !img) {
          ev.preventDefault();
          setActiveBlockId(id);
          setActiveImageId("");
          setIsTextActive(false);
        }
      });
    });
  }

  function getActiveBlockEl() {
    const canvas = editorRef.current;
    if (!canvas || !activeBlockId) return null;
    return canvas.querySelector(`[data-gr8-id="${activeBlockId}"]`);
  }

  function deleteActiveBlock() {
    const el = getActiveBlockEl();
    if (!el) return;
    el.remove();
    setActiveBlockId("");
    setStatus("Block deleted");
  }

  function duplicateActiveBlock() {
    const el = getActiveBlockEl();
    if (!el) return;
    const clone = el.cloneNode(true);
    clone.setAttribute("data-gr8-id", uid());
    // ensure cloned images get new ids
    markImageZones(clone);

    el.parentNode?.insertBefore(clone, el.nextSibling);

    const id = clone.getAttribute("data-gr8-id");
    clone.addEventListener("mousedown", (ev) => {
      const t = ev.target?.closest?.('[data-gr8-text="1"]');
      const img = ev.target?.closest?.('[data-gr8-img="1"]');
      if (!t && !img) {
        ev.preventDefault();
        setActiveBlockId(id);
        setActiveImageId("");
        setIsTextActive(false);
      }
    });

    setStatus("Block duplicated");
  }

  function moveActive(delta) {
    const el = getActiveBlockEl();
    if (!el || !el.parentNode) return;
    const parent = el.parentNode;
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= siblings.length) return;
    const ref = siblings[nextIdx];
    if (delta < 0) parent.insertBefore(el, ref);
    else parent.insertBefore(el, ref.nextSibling);
    setStatus("Block moved");
  }

  // ---------- TEXT PRESETS (insert where cursor is, else end) ----------
  function insertWrapperAtSelection(wrapper) {
    const canvas = editorRef.current;
    if (!canvas) return false;

    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const r = sel.getRangeAt(0);
      if (!canvas.contains(r.commonAncestorContainer)) return false;

      // find nearest block around selection
      const node =
        r.commonAncestorContainer.nodeType === 1
          ? r.commonAncestorContainer
          : r.commonAncestorContainer.parentElement;
      const blk = node?.closest?.("[data-gr8-block='1']");
      if (blk && canvas.contains(blk)) {
        canvas.insertBefore(wrapper, blk.nextSibling);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function addTextPreset(kind) {
    const canvas = editorRef.current;
    if (!canvas) return;

    const wrapper = document.createElement("div");
    wrapper.className = "gr8Block";
    const id = uid();
    wrapper.setAttribute("data-gr8-block", "1");
    wrapper.setAttribute("data-gr8-id", id);
    wrapper.contentEditable = "false";

    const body = document.createElement("div");
    body.className = "gr8Body";

    const node = document.createElement(kind === "p" ? "p" : kind);
    node.setAttribute("data-gr8-text", "1");
    node.contentEditable = "true";
    node.style.margin = "0";
    node.style.fontFamily = "Arial, sans-serif";
    node.style.color = "#111827";

    if (kind === "h1") node.style.fontSize = "42px";
    if (kind === "h2") node.style.fontSize = "34px";
    if (kind === "h3") node.style.fontSize = "28px";
    if (kind === "h4") node.style.fontSize = "22px";
    if (kind === "p") node.style.fontSize = "16px";

    node.textContent = kind === "p" ? "Paragraph text…" : `${kind.toUpperCase()} Heading…`;

    body.appendChild(node);
    wrapper.appendChild(body);

    wrapper.addEventListener("mousedown", (ev) => {
      const t = ev.target?.closest?.('[data-gr8-text="1"]');
      const img = ev.target?.closest?.('[data-gr8-img="1"]');
      if (!t && !img) {
        ev.preventDefault();
        setActiveBlockId(id);
        setActiveImageId("");
        setIsTextActive(false);
      }
    });

    // TRY to insert near current selection, else append
    if (!insertWrapperAtSelection(wrapper)) {
      canvas.appendChild(wrapper);
    }

    setStatus(`Added ${kind.toUpperCase()}`);
  }

  // ---------- FILE MENU ----------
  function snapshotDoc() {
    const canvas = editorRef.current;
    const html = canvas ? canvas.innerHTML : "";
    return {
      html,
      canvasWidth,
      mode,
      customWidth,
      bgType,
      bgColor,
      bgGradient,
      bgImageUrl,
      bgImageFit,
      savedAt: new Date().toISOString(),
    };
  }

  function applyDoc(doc) {
    const canvas = editorRef.current;
    if (!canvas) return;
    const d = doc || {};
    setMode(String(d.mode || "1320"));
    setCustomWidth(Number(d.customWidth || 1320));
    setBgType(d.bgType || "solid");
    setBgColor(d.bgColor || "#ffffff");
    setBgGradient(d.bgGradient || GRADIENTS[0].value);
    setBgImageUrl(d.bgImageUrl || "");
    setBgImageFit(d.bgImageFit || "cover");

    canvas.innerHTML = safeStr(d.html || "");
    normalizeCanvas(canvas);
    setActiveBlockId("");
    setActiveImageId("");
    setStatus("File opened");
  }

  function doSave(name) {
    const nm = safeStr(name).trim();
    if (!nm) return;
    const next = { ...(docs || {}) };
    next[nm] = snapshotDoc();
    saveDocs(next);
    setDocs(next);
    setCurrentDocName(nm);
    setStatus(`Saved: ${nm}`);
  }

  function handleSave() {
    if (currentDocName) doSave(currentDocName);
    else {
      setSaveAsName("");
      setSaveAsOpen(true);
    }
  }

  function handleSaveAs(name) {
    const nm = safeStr(name).trim();
    if (!nm) return;
    doSave(nm);
    setSaveAsOpen(false);
  }

  function handleOpen(name) {
    const nm = safeStr(name).trim();
    if (!nm) return;
    const d = docs?.[nm];
    if (!d) return;
    setCurrentDocName(nm);
    applyDoc(d);
    setOpenDialog(false);
  }

  function handleDeleteFile(name) {
    const nm = safeStr(name).trim();
    if (!nm) return;
    const next = { ...(docs || {}) };
    delete next[nm];
    saveDocs(next);
    setDocs(next);
    if (currentDocName === nm) setCurrentDocName("");
    setStatus("File deleted");
  }

  // ---------- UI ----------
  const blockCategories = useMemo(
    () => [
      {
        name: "TEXT",
        items: [
          { key: "h1", label: "H1", action: () => addTextPreset("h1") },
          { key: "h2", label: "H2", action: () => addTextPreset("h2") },
          { key: "h3", label: "H3", action: () => addTextPreset("h3") },
          { key: "h4", label: "H4", action: () => addTextPreset("h4") },
          { key: "p", label: "Paragraph", action: () => addTextPreset("p") },
          { key: "text", label: "Text Block", draggable: true },
          { key: "button", label: "Button", draggable: true },
        ],
      },
      {
        name: "LAYOUT",
        items: [
          { key: "columns", label: "Columns", draggable: true },
          { key: "spacer", label: "Spacer", draggable: true },
          { key: "divider", label: "Divider", draggable: true },
        ],
      },
      {
        name: "MEDIA",
        items: [{ key: "image", label: "Image", draggable: true }, { key: "html", label: "HTML", draggable: true }],
      },
      {
        name: "SOCIAL",
        items: [{ key: "social", label: "Social", draggable: true }],
      },
    ],
    []
  );

  return (
    <div className="wrap">
      <div className="inner" style={{ width: `${canvasWidth}px` }}>
        {/* LEFT WING */}
        <aside className="panel wingLeft">
          <div className="tabs">
            <button className={`tabBtn ${leftTab === "blocks" ? "on" : ""}`} onClick={() => setLeftTab("blocks")} type="button">
              Blocks
            </button>
            <button className={`tabBtn ${leftTab === "background" ? "on" : ""}`} onClick={() => setLeftTab("background")} type="button">
              Background
            </button>
          </div>

          {leftTab === "blocks" ? (
            <>
              {blockCategories.map((cat) => (
                <div key={cat.name} className="cat">
                  <div className="catTitle">{cat.name}</div>
                  <div className="catGrid">
                    {cat.items.map((it) =>
                      it.action ? (
                        <button key={it.key} className="sqBtn" onClick={it.action} type="button">
                          {it.label}
                        </button>
                      ) : (
                        <div key={it.key} className={`blk blk_${it.key}`} draggable={!!it.draggable} onDragStart={(e) => onDragStart(e, it.key)}>
                          {it.label}
                        </div>
                      )
                    )}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="pSub">Set canvas background</div>

              <div className="bgRow">
                <button className={`bgBtn ${bgType === "solid" ? "on" : ""}`} onClick={() => setBgType("solid")} type="button">
                  Colour
                </button>
                <button className={`bgBtn ${bgType === "gradient" ? "on" : ""}`} onClick={() => setBgType("gradient")} type="button">
                  Gradient
                </button>
                <button className={`bgBtn ${bgType === "image" ? "on" : ""}`} onClick={() => setBgType("image")} type="button">
                  Image
                </button>
              </div>

              {bgType === "solid" ? (
                <>
                  <div className="palette">
                    {STANDARD_COLOURS.map((c) => (
                      <button key={c} className="sw" style={{ background: c }} onClick={() => setBgColor(c)} type="button" />
                    ))}
                  </div>

                  <div className="bgCard">
                    <div className="bgLabel">Custom</div>
                    <div className="bgCustomRow">
                      <input className="colorInput" type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                      <input className="hexInput" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                    </div>
                  </div>
                </>
              ) : null}

              {bgType === "gradient" ? (
                <div className="bgCard">
                  <div className="bgLabel">Gradient presets</div>
                  <div className="gradList">
                    {GRADIENTS.map((g) => (
                      <button key={g.name} className={`gradBtn ${bgGradient === g.value ? "on" : ""}`} onClick={() => setBgGradient(g.value)} type="button">
                        <span className="gradSw" style={{ background: g.value }} />
                        <span>{g.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {bgType === "image" ? (
                <>
                  <div className="bgCard">
                    <div className="bgLabel">Base colour</div>
                    <div className="bgCustomRow">
                      <input className="colorInput" type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                      <input className="hexInput" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                    </div>

                    <div className="bgLabel" style={{ marginTop: 10 }}>
                      Fit
                    </div>
                    <select className="selectDark" value={bgImageFit} onChange={(e) => setBgImageFit(e.target.value)}>
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                      <option value="repeat">Repeat</option>
                    </select>
                  </div>

                  <div className="bgCard">
                    <div className="bgLabel">Upload</div>
                    <label className="uploadBtn">
                      {uploading ? "Uploading…" : "Choose file"}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) onUploadImage(f, { setAsBackground: true, setAsBlockImage: false });
                        }}
                        style={{ display: "none" }}
                      />
                    </label>

                    <button className="ghostBtn" type="button" onClick={refreshImages} disabled={!userId || loadingImages}>
                      {loadingImages ? "Loading…" : "Refresh library"}
                    </button>
                  </div>

                  <div className="bgCard">
                    <div className="bgLabel">Library</div>
                    {!userId ? (
                      <div className="small">Log in to use your image library.</div>
                    ) : imageUrls.length ? (
                      <div className="imgGrid">
                        {imageUrls.map((u) => (
                          <button
                            key={u}
                            type="button"
                            className={`imgThumb ${bgImageUrl === u ? "on" : ""}`}
                            onClick={() => {
                              setBgImageUrl(u);
                              setStatus("Background image set");
                            }}
                          >
                            <img src={u} alt="" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="small">No images yet.</div>
                    )}
                  </div>
                </>
              ) : null}
            </>
          )}

          <div className="status">
            <div className="sL">Status</div>
            <div className="sV">{status}</div>
          </div>
        </aside>

        {/* CENTER */}
        <section className="center">
          {/* FILE MENU BAR (inside editor area; line up with your banner width) */}
          <div className="topbar">
            <div className="fileWrap">
              <button className={`fileBtn ${fileOpen ? "on" : ""}`} type="button" onClick={() => setFileOpen((v) => !v)}>
                File ▾
              </button>
              {fileOpen ? (
                <div className="fileMenu" onMouseLeave={() => setFileOpen(false)}>
                  <button type="button" onClick={() => { setFileOpen(false); handleSave(); }}>
                    Save {currentDocName ? `(${currentDocName})` : ""}
                  </button>
                  <button type="button" onClick={() => { setFileOpen(false); setSaveAsName(currentDocName || ""); setSaveAsOpen(true); }}>
                    Save As…
                  </button>
                  <button type="button" onClick={() => { setFileOpen(false); setOpenDialog(true); }}>
                    Open…
                  </button>
                </div>
              ) : null}
            </div>

            <div className="docHint">
              {currentDocName ? (
                <>
                  <span className="docName">{currentDocName}</span>
                  <span className="docDot">•</span>
                  <span className="docMeta">{docNames.length} files</span>
                </>
              ) : (
                <span className="docMeta">No file selected</span>
              )}
            </div>
          </div>

          <div className="controls">
            <div className="ctlRow">
              <div className="ctlLabel">Canvas width</div>

              <div className="seg">
                {PRESETS.map((w) => (
                  <button key={w} type="button" className={`segBtn ${mode === String(w) ? "on" : ""}`} onClick={() => setMode(String(w))}>
                    {w}
                  </button>
                ))}
                <button type="button" className={`segBtn ${mode === "custom" ? "on" : ""}`} onClick={() => setMode("custom")}>
                  Custom
                </button>
              </div>

              <div className="rightBits">
                {mode === "custom" ? (
                  <input className="customInput" type="number" min="320" max="2400" value={customWidth} onChange={(e) => setCustomWidth(e.target.value)} />
                ) : null}
                <div className="val">{canvasWidth}px</div>
              </div>
            </div>
          </div>

          <div className="canvasOuter" onDragOver={onDragOver} onDrop={onDrop}>
            <div ref={dropLineRef} className="dropLine" />

            <div className="canvasStage">
              <div className="canvasFrame" style={{ width: `${canvasWidth}px`, ...canvasFrameStyle() }}>
                {activeBlockId ? (
                  <div className="blockActions" contentEditable={false}>
                    <div className="baLeft">Block</div>
                    <div className="baBtns">
                      <button type="button" onClick={() => moveActive(-1)}>↑</button>
                      <button type="button" onClick={() => moveActive(1)}>↓</button>
                      <button type="button" onClick={duplicateActiveBlock}>Duplicate</button>
                      <button type="button" className="danger" onClick={deleteActiveBlock}>Delete</button>
                    </div>
                  </div>
                ) : null}

                <div
                  ref={editorRef}
                  className="canvasDoc"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck
                  onMouseUp={rememberSelection}
                  onKeyUp={rememberSelection}
                  onInput={rememberSelection}
                  onClick={(e) => {
                    rememberSelection();

                    // IMAGE CLICK: switch panel to image tools
                    const img = e.target?.closest?.('[data-gr8-img="1"]');
                    if (img && editorRef.current?.contains(img)) {
                      const id = img.getAttribute("data-gr8-img-id") || uid();
                      img.setAttribute("data-gr8-img-id", id);
                      setActiveImageId(id);
                      setActiveBlockId("");
                      setIsTextActive(false);
                      setStatus("Image selected");
                      return;
                    }

                    // clicking inside text = keep text tools, close image tools
                    const t = e.target?.closest?.('[data-gr8-text="1"]');
                    if (t) {
                      setActiveImageId("");
                      return;
                    }

                    // click empty or non-text/non-image: clear image + (optionally) block
                    const blk = e.target?.closest?.("[data-gr8-block='1']");
                    if (!blk) {
                      setActiveBlockId("");
                      setActiveImageId("");
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT WING (Text OR Image tools) */}
        <aside className="panel wingRight">
          {isImageActive ? (
            <>
              <div className="pTitleCyan">Image Tools</div>
              <div className="pSub">Click another image to switch • Click text to return to Text Tools</div>

              <div className="imgTabs">
                <button className={`imgTab ${imgTab === "library" ? "on" : ""}`} type="button" onClick={() => setImgTab("library")}>
                  Your Library
                </button>
                <button className={`imgTab ${imgTab === "stock" ? "on" : ""}`} type="button" onClick={() => setImgTab("stock")}>
                  Stock (Web)
                </button>
              </div>

              <div className="imgActions">
                <button className="ghostBtn" type="button" onClick={() => { setActiveImageId(""); setStatus("Closed image tools"); }}>
                  Close
                </button>
                <button className="dangerBtn" type="button" onClick={removeActiveImage}>
                  Clear
                </button>
              </div>

              {imgTab === "library" ? (
                <>
                  {!userId ? (
                    <div className="hint">
                      Log in to use your image library.
                      <div className="hintSmall">You can still use Stock images.</div>
                    </div>
                  ) : (
                    <>
                      <div className="bgCard">
                        <div className="bgLabel">Upload (replaces selected image)</div>
                        <label className="uploadBtn">
                          {uploading ? "Uploading…" : "Choose file"}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) onUploadImage(f, { setAsBackground: false, setAsBlockImage: true });
                            }}
                            style={{ display: "none" }}
                          />
                        </label>

                        <button className="ghostBtn" type="button" onClick={refreshImages} disabled={loadingImages}>
                          {loadingImages ? "Loading…" : "Refresh library"}
                        </button>
                      </div>

                      <div className="bgCard">
                        <div className="bgLabel">Library</div>
                        {imageUrls.length ? (
                          <div className="imgGrid">
                            {imageUrls.map((u) => (
                              <button
                                key={u}
                                type="button"
                                className="imgThumb"
                                onClick={() => setActiveImageSrc(u)}
                                title="Set image"
                              >
                                <img src={u} alt="" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="small">No images yet.</div>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="bgCard">
                    <div className="bgLabel">Stock website images</div>
                    <button className="ghostBtn" type="button" onClick={() => setStockIds(makePicsumIds(18))}>
                      Refresh stock images
                    </button>
                    <div className="imgGrid" style={{ marginTop: 10 }}>
                      {stockIds.map((id) => {
                        const u = `https://picsum.photos/id/${id}/600/400`;
                        return (
                          <button key={id} type="button" className="imgThumb" onClick={() => setActiveImageSrc(u)} title="Set image">
                            <img src={u} alt="" />
                          </button>
                        );
                      })}
                    </div>
                    <div className="small" style={{ marginTop: 8 }}>
                      Tip: click to replace the selected image.
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="pTitleGreen">Text Tools</div>
              <div className="pSub">Visible only while editing text</div>

              {isTextActive ? (
                <RichTextToolbar
                  editorRef={editorRef}
                  restoreSelection={restoreSelection}
                  rememberSelection={rememberSelection}
                  setStatus={setStatus}
                />
              ) : (
                <div className="hint">
                  Click into text to edit it.
                  <div className="hintSmall">Click an image to open Image Tools.</div>
                </div>
              )}
            </>
          )}
        </aside>

        {/* SAVE AS MODAL */}
        {saveAsOpen ? (
          <div className="modalBack" onMouseDown={() => setSaveAsOpen(false)}>
            <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="mTitle">Save As</div>
              <div className="mSub">Existing files (to avoid overwriting):</div>
              <div className="fileList">
                {docNames.length ? (
                  docNames.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`fileRow ${saveAsName === n ? "on" : ""}`}
                      onClick={() => setSaveAsName(n)}
                      title="Select file name"
                    >
                      <span className="fileName">{n}</span>
                      <span className="fileTime">{docs?.[n]?.savedAt ? new Date(docs[n].savedAt).toLocaleString() : ""}</span>
                    </button>
                  ))
                ) : (
                  <div className="small">No saved files yet.</div>
                )}
              </div>

              <div className="mSub" style={{ marginTop: 10 }}>New name (or choose an existing name above):</div>
              <input className="mInput" value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} placeholder="e.g. Welcome Email v1" />

              <div className="mBtns">
                <button className="ghostBtn" type="button" onClick={() => setSaveAsOpen(false)}>
                  Cancel
                </button>
                <button className="segBtn on" type="button" onClick={() => handleSaveAs(saveAsName)}>
                  Save As
                </button>
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                If you select an existing name, it will overwrite that file.
              </div>
            </div>
          </div>
        ) : null}

        {/* OPEN MODAL */}
        {openDialog ? (
          <div className="modalBack" onMouseDown={() => setOpenDialog(false)}>
            <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="mTitle">Open File</div>
              <div className="mSub">Choose a file:</div>
              <div className="fileList">
                {docNames.length ? (
                  docNames.map((n) => (
                    <div key={n} className="openRow">
                      <button className="fileRow on" type="button" onClick={() => handleOpen(n)} title="Open file">
                        <span className="fileName">{n}</span>
                        <span className="fileTime">{docs?.[n]?.savedAt ? new Date(docs[n].savedAt).toLocaleString() : ""}</span>
                      </button>
                      <button className="miniDanger" type="button" onClick={() => handleDeleteFile(n)} title="Delete file">
                        Delete
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="small">No saved files yet.</div>
                )}
              </div>

              <div className="mBtns">
                <button className="ghostBtn" type="button" onClick={() => setOpenDialog(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <style jsx>{`
        .wrap { width: 100%; display: flex; justify-content: center; }
        .inner { position: relative; display: block; padding: 0; }

        .panel {
          background: #0b1120;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          padding: 12px;
          min-height: 720px;
          width: 260px;
          box-sizing: border-box;
        }
        .wingLeft { position: absolute; top: 0; right: calc(100% + 14px); }
        .wingRight { position: absolute; top: 0; left: calc(100% + 14px); width: 360px; }

        .tabs { display: flex; gap: 10px; margin-bottom: 12px; }
        .tabBtn {
          flex: 1; height: 36px; border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(2, 6, 23, 0.35);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
        }
        .tabBtn.on { border-color: rgba(96, 165, 250, 0.75); box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }

        .pTitleGreen { font-size: 18px; font-weight: 900; color: #22c55e; margin-bottom: 6px; }
        .pTitleCyan { font-size: 18px; font-weight: 900; color: #22d3ee; margin-bottom: 6px; }
        .pSub { font-size: 14px; opacity: 0.9; margin-bottom: 12px; color: #e5e7eb; }

        .cat { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(148,163,184,0.14); }
        .catTitle { font-size: 12px; font-weight: 900; opacity: 0.9; margin-bottom: 8px; letter-spacing: .08em; color: #e5e7eb; }
        .catGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

        .blk, .sqBtn { border-radius: 14px; padding: 14px 10px; font-weight: 900; text-align: center; user-select: none; }
        .blk { cursor: grab; color: #0b1120; }
        .sqBtn {
          cursor: pointer; border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35); color: #e5e7eb;
        }

        .blk_text { background: #60a5fa; }
        .blk_button { background: #22c55e; }
        .blk_divider { background: #facc15; }
        .blk_spacer { background: #eab308; }
        .blk_columns { background: #a855f7; color: #fff; }
        .blk_image { background: #0ea5e9; }
        .blk_social { background: #ec4899; color: #fff; }
        .blk_html { background: #f97316; }

        .bgRow { display: flex; gap: 10px; margin-bottom: 10px; }
        .bgBtn {
          flex: 1; height: 34px; border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
        }
        .bgBtn.on { border-color: rgba(34,197,94,0.75); box-shadow: 0 0 0 3px rgba(34,197,94,0.16); }

        .palette { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-bottom: 10px; }
        .sw { height: 28px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.16); cursor: pointer; }

        .bgCard { border-radius: 14px; border: 1px solid rgba(148,163,184,0.18); background: rgba(2,6,23,0.25); padding: 10px; margin-top: 10px; }
        .bgLabel { font-size: 12px; opacity: 0.92; margin-bottom: 8px; font-weight: 900; color: #e5e7eb; }
        .bgCustomRow { display: grid; grid-template-columns: 52px 1fr; gap: 10px; align-items: center; }
        .colorInput {
          width: 52px; height: 40px; border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35); padding: 6px;
        }
        .hexInput {
          height: 40px; border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; padding: 0 10px; font-weight: 900; outline: none;
        }

        .gradList { display: grid; gap: 8px; }
        .gradBtn {
          display: flex; align-items: center; gap: 10px;
          padding: 10px; border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.18);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; cursor: pointer; font-weight: 900; text-align: left;
        }
        .gradBtn.on { border-color: rgba(96,165,250,0.75); box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }
        .gradSw { width: 42px; height: 22px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22); flex: 0 0 auto; }

        .selectDark {
          width: 100%; height: 40px; border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.55);
          color: #e5e7eb; font-weight: 900; padding: 0 10px; outline: none;
        }

        .uploadBtn {
          display: inline-flex; justify-content: center; align-items: center;
          width: 100%; height: 42px; border-radius: 12px;
          border: 1px solid rgba(96,165,250,0.55);
          background: rgba(59,130,246,0.18);
          color: #e5e7eb; font-weight: 900; cursor: pointer; margin-bottom: 10px;
        }

        .ghostBtn {
          width: 100%; height: 40px; border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
        }
        .dangerBtn {
          height: 40px; border-radius: 12px;
          border: 1px solid rgba(239,68,68,0.45);
          background: rgba(239,68,68,0.12);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
          padding: 0 12px;
        }

        .imgGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .imgThumb {
          border: 2px solid rgba(255,255,255,0.12);
          background: rgba(2,6,23,0.35);
          border-radius: 12px;
          overflow: hidden;
          padding: 0;
          cursor: pointer;
          height: 74px;
        }
        .imgThumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

        .status { margin-top: 14px; border-top: 1px solid rgba(148,163,184,0.18); padding-top: 12px; }
        .sL { font-size: 12px; opacity: 0.85; color: #e5e7eb; }
        .sV { font-size: 14px; font-weight: 900; margin-top: 4px; color: #e5e7eb; }

        .center {
          width: 100%;
          background: #0b1120;
          border-radius: 16px;
          border: 1px solid rgba(148,163,184,0.18);
          padding: 12px;
          min-height: 720px;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .fileWrap { position: relative; }
        .fileBtn {
          height: 36px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb;
          font-weight: 900;
          cursor: pointer;
        }
        .fileBtn.on { border-color: rgba(96,165,250,0.75); box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }
        .fileMenu {
          position: absolute;
          top: 42px;
          left: 0;
          min-width: 200px;
          border-radius: 14px;
          border: 1px solid rgba(148,163,184,0.18);
          background: rgba(2,6,23,0.95);
          box-shadow: 0 16px 60px rgba(0,0,0,0.5);
          padding: 8px;
          z-index: 100;
        }
        .fileMenu button {
          width: 100%;
          text-align: left;
          height: 38px;
          border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.12);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb;
          font-weight: 900;
          cursor: pointer;
          padding: 0 12px;
          margin-bottom: 6px;
        }
        .docHint { display: flex; align-items: center; gap: 8px; color: #e5e7eb; }
        .docName { font-weight: 900; }
        .docDot { opacity: 0.6; }
        .docMeta { opacity: 0.9; font-weight: 800; }

        .controls { margin-bottom: 10px; }
        .ctlRow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .ctlLabel { font-size: 14px; opacity: 0.9; min-width: 96px; font-weight: 900; color: #e5e7eb; }
        .seg { display: inline-flex; gap: 8px; flex-wrap: wrap; }
        .segBtn {
          height: 32px; padding: 0 12px; border-radius: 999px;
          border: 1px solid rgba(148,163,184,0.28);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
        }
        .segBtn.on { border-color: rgba(96,165,250,0.75); box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }
        .rightBits { margin-left: auto; display: inline-flex; align-items: center; gap: 10px; }
        .customInput {
          width: 110px; height: 32px; border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.28);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; padding: 0 10px; font-weight: 900; outline: none;
        }
        .val { font-size: 14px; font-weight: 900; min-width: 72px; text-align: right; opacity: 0.95; color: #e5e7eb; }

        .canvasOuter {
          position: relative;
          flex: 1;
          overflow: auto;
          padding: 16px;
          border-radius: 14px;
          border: 1px dashed rgba(148,163,184,0.35);
          background: rgba(2,6,23,0.35);
        }

        /* drop line now uses absolute inside canvasOuter */
        .dropLine {
          position: absolute;
          left: 16px;
          right: 16px;
          height: 4px;
          border-radius: 999px;
          background: #22c55e;
          display: none;
          pointer-events: none;
          z-index: 60;
        }

        .canvasStage { position: relative; width: 100%; display: flex; justify-content: center; align-items: flex-start; }
        .canvasFrame {
          position: relative;
          flex: 0 0 auto;
          border-radius: 14px;
          box-shadow: 0 16px 60px rgba(0,0,0,0.45);
          overflow: hidden;
          min-height: 900px;
        }
        .canvasDoc {
          position: relative;
          z-index: 2;
          min-height: 900px;
          padding: 24px;
          outline: none;
          color: #111827;
          font-size: 16px;
          line-height: 1.6;
          background: transparent;
        }

        .blockActions {
          position: sticky;
          top: 10px;
          z-index: 20;
          margin: 10px;
          padding: 8px 10px;
          border-radius: 12px;
          background: rgba(17,24,39,0.92);
          border: 1px solid rgba(148,163,184,0.22);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          backdrop-filter: blur(8px);
        }
        .baLeft { font-weight: 900; color: #e5e7eb; font-size: 12px; opacity: 0.9; }
        .baBtns { display: flex; gap: 8px; flex-wrap: wrap; }
        .baBtns button {
          height: 30px; padding: 0 10px; border-radius: 999px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
        }
        .baBtns button.danger {
          border-color: rgba(239,68,68,0.45);
          background: rgba(239,68,68,0.12);
        }

        .hint {
          padding: 12px;
          border-radius: 14px;
          border: 1px solid rgba(148,163,184,0.18);
          background: rgba(2,6,23,0.25);
          font-weight: 900;
          color: #e5e7eb;
          line-height: 1.35;
        }
        .hintSmall { margin-top: 6px; font-size: 13px; opacity: 0.9; font-weight: 800; }
        .small { color: #e5e7eb; opacity: 0.85; font-weight: 800; font-size: 13px; }

        /* image tools tabs */
        .imgTabs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
        .imgTab {
          height: 36px; border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb; font-weight: 900; cursor: pointer;
        }
        .imgTab.on { border-color: rgba(34,211,238,0.75); box-shadow: 0 0 0 3px rgba(34,211,238,0.14); }

        .imgActions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }

        /* MODALS */
        .modalBack {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          padding: 20px;
        }
        .modal {
          width: min(720px, 100%);
          border-radius: 16px;
          border: 1px solid rgba(148,163,184,0.18);
          background: rgba(2,6,23,0.98);
          box-shadow: 0 16px 70px rgba(0,0,0,0.6);
          padding: 14px;
          color: #e5e7eb;
        }
        .mTitle { font-weight: 900; font-size: 18px; margin-bottom: 8px; }
        .mSub { font-weight: 800; opacity: 0.9; font-size: 13px; margin-bottom: 8px; }
        .fileList {
          border-radius: 14px;
          border: 1px solid rgba(148,163,184,0.18);
          background: rgba(2,6,23,0.35);
          padding: 8px;
          max-height: 260px;
          overflow: auto;
        }
        .fileRow {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          height: 40px;
          border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.12);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb;
          font-weight: 900;
          cursor: pointer;
          padding: 0 12px;
          margin-bottom: 6px;
        }
        .fileRow.on { border-color: rgba(96,165,250,0.55); box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
        .fileName { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
        .fileTime { opacity: 0.85; font-weight: 800; font-size: 12px; }

        .mInput {
          width: 100%;
          height: 40px;
          border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,0.35);
          color: #e5e7eb;
          padding: 0 12px;
          font-weight: 900;
          outline: none;
        }
        .mBtns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }

        .openRow { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin-bottom: 6px; }
        .miniDanger {
          height: 40px;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid rgba(239,68,68,0.45);
          background: rgba(239,68,68,0.12);
          color: #e5e7eb;
          font-weight: 900;
          cursor: pointer;
        }

        /* block visuals inside canvas */
        :global(.gr8Block) {
          position: relative;
          margin: 10px 0;
          border-radius: 14px;
          border: 1px solid rgba(15,23,42,0.12);
          background: rgba(255,255,255,0.86);
        }
        :global(.gr8Body) { padding: 14px; }
        :global(.gr8Block:hover) { outline: 3px solid rgba(59,130,246,0.18); }
        :global([data-gr8-text="1"]) { cursor: text; }
        :global([data-gr8-img="1"]) { cursor: pointer; }

        /* RESPONSIVE fallback */
        @media (max-width: 1400px) {
          .inner { width: 100% !important; max-width: 100%; }
          .wingLeft, .wingRight { position: static; width: 100%; margin-bottom: 14px; }
          .panel { width: 100%; }
          .center { width: 100%; }
        }
      `}</style>
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}
