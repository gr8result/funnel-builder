// /components/email/editor/RichTextToolbar.js
// FULL REPLACEMENT — instant font/size/colour (no Apply). Uses last selection from EditorLayout.
// ✅ Dropdowns (as you asked) for colours + sizes + fonts
// ✅ Clicking a choice immediately applies
// ✅ Works with contentEditable reliably (wraps selection in a styled span)

import { useEffect, useMemo, useState } from "react";

const FONTS = [
  "Arial",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Nunito",
  "Raleway",
  "Merriweather",
  "Playfair Display",
  "DM Sans",
  "Work Sans",
  "Rubik",
];

const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72];

export default function RichTextToolbar({ editorRef, restoreSelection, rememberSelection, setStatus, palette }) {
  const [font, setFont] = useState("Arial");
  const [size, setSize] = useState(16);
  const [color, setColor] = useState("#111827");
  const [custom, setCustom] = useState("#111827");

  const colors = useMemo(() => {
    const base = Array.isArray(palette) && palette.length ? palette : ["#111827", "#000000", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#9ca3af"];
    return Array.from(new Set(base.map(String)));
  }, [palette]);

  function focusCanvas() {
    const el = editorRef?.current;
    if (el) el.focus();
  }

  function exec(cmd) {
    focusCanvas();
    restoreSelection();
    try {
      document.execCommand(cmd, false, null);
      rememberSelection();
    } catch {}
  }

  function wrapStyle(styleObj) {
    focusCanvas();
    const ok = restoreSelection();
    if (!ok) return setStatus?.("Select text first");

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return setStatus?.("Select text first");
    const r = sel.getRangeAt(0);
    if (r.collapsed) return setStatus?.("Select text first");

    const span = document.createElement("span");
    Object.assign(span.style, styleObj);

    const frag = r.extractContents();
    span.appendChild(frag);
    r.insertNode(span);

    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.addRange(nr);

    rememberSelection();
  }

  // instant apply handlers
  function applyFont(v) {
    setFont(v);
    wrapStyle({ fontFamily: v });
    setStatus?.(`Font: ${v}`);
  }

  function applySize(v) {
    const px = Number(v) || 16;
    setSize(px);
    wrapStyle({ fontSize: `${px}px` });
    setStatus?.(`Size: ${px}px`);
  }

  function applyColor(v) {
    setColor(v);
    wrapStyle({ color: v });
    setStatus?.(`Colour set`);
  }

  function applyCustom() {
    const v = String(custom || "").trim();
    if (!v) return;
    applyColor(v);
  }

  function clearFormatting() {
    focusCanvas();
    restoreSelection();
    try {
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
    } catch {}
    setStatus?.("Formatting cleared");
  }

  return (
    <div className="rt" onMouseDown={(e) => e.stopPropagation()}>
      <div className="row">
        <button className="ic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}>
          B
        </button>
        <button className="ic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")}>
          I
        </button>
        <button className="ic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")}>
          U
        </button>
        <button className="ic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("strikeThrough")}>
          S
        </button>
      </div>

      <div className="row">
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("justifyLeft")}>
          Left
        </button>
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("justifyCenter")}>
          Center
        </button>
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("justifyRight")}>
          Right
        </button>
      </div>

      <div className="row">
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}>
          • List
        </button>
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")}>
          1. List
        </button>
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("outdent")}>
          Out
        </button>
        <button className="pill" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("indent")}>
          In
        </button>
      </div>

      <div className="box">
        <div className="lab">Font</div>
        <select
          className="sel"
          value={font}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyFont(e.target.value)}
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="box">
        <div className="lab">Size</div>
        <select
          className="sel"
          value={size}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applySize(e.target.value)}
        >
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
      </div>

      <div className="box">
        <div className="lab">Colour</div>
        <select
          className="sel"
          value={color}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyColor(e.target.value)}
        >
          {colors.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="custom">
          <input className="hex" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="set" onMouseDown={(e) => e.preventDefault()} onClick={applyCustom}>
            Set
          </button>
        </div>
      </div>

      <button className="clear" onMouseDown={(e) => e.preventDefault()} onClick={clearFormatting}>
        Clear Formatting
      </button>

      <style jsx>{`
        .rt {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .row {
          display: flex;
          gap: 8px;
        }
        .ic {
          width: 44px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
        }
        .pill {
          flex: 1;
          height: 36px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
        }
        .box {
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(2, 6, 23, 0.35);
          border-radius: 14px;
          padding: 10px;
        }
        .lab {
          font-size: 12px;
          color: rgba(226, 232, 240, 0.85);
          font-weight: 900;
          margin-bottom: 8px;
        }
        .sel {
          width: 100%;
          height: 42px;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          font-weight: 900;
          outline: none;
          padding: 0 10px;
        }
        .custom {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
        .hex {
          flex: 1;
          height: 40px;
          border-radius: 12px;
          padding: 0 12px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          outline: none;
          font-weight: 900;
        }
        .set {
          width: 74px;
          height: 40px;
          border-radius: 12px;
          border: 1px solid rgba(34, 197, 94, 0.35);
          background: rgba(34, 197, 94, 0.22);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
        }
        .clear {
          height: 44px;
          border-radius: 12px;
          border: 1px solid rgba(239, 68, 68, 0.35);
          background: rgba(239, 68, 68, 0.22);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
