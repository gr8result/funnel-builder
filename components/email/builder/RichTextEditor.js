// components/email/builder/RichTextEditor.js
// ============================================
// GR8 RESULT — RichTextEditor (standalone module)
// FULL REPLACEMENT
//
// ✅ Does NOT rewrite innerHTML while typing (prevents line-collapse)
// ✅ Preserves newlines (<div>/<br>)
// ✅ Forces LTR so it stops typing backwards
// ✅ Exposes imperative methods for toolbar:
//    - applyInlineStyle({ fontFamily, fontSize, color, fontWeight, fontStyle, textDecoration })
//    - applyBlockStyle({ textAlign, lineHeight })
// ============================================

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const safe = (v) => (v == null ? "" : String(v));

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
  return Math.max(a, Math.min(b, x));
}

// Minimal sanitizer:
// - remove scripts/iframes
// - keep div/p/br/span/b/i/u/a/ul/ol/li
// - keep span style only for a safe allowlist
function sanitizeHtml(inputHtml) {
  const html = safe(inputHtml || "");
  if (typeof window === "undefined") return html;

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  tmp.querySelectorAll("script,style,iframe,object,embed").forEach((n) => n.remove());

  const allowedTags = new Set(["div", "p", "br", "span", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li"]);
  const allowedSpanStyles = new Set([
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-decoration",
    "letter-spacing",
  ]);

  const all = tmp.querySelectorAll("*");
  all.forEach((el) => {
    const tag = el.tagName.toLowerCase();

    if (!allowedTags.has(tag)) {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      return;
    }

    // Strip attributes except safe ones
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();

      if (tag === "a" && (name === "href" || name === "target" || name === "rel")) return;

      if (tag === "span" && name === "style") {
        const raw = safe(el.getAttribute("style") || "");
        const safeStyle = raw
          .split(";")
          .map((x) => x.trim())
          .filter((x) => {
            const m = x.match(/^([a-z-]+)\s*:/i);
            if (!m) return false;
            return allowedSpanStyles.has(m[1].toLowerCase());
          })
          .join("; ");
        if (safeStyle) el.setAttribute("style", safeStyle);
        else el.removeAttribute("style");
        return;
      }

      // allow block-level style only for align/line-height on div/p
      if ((tag === "div" || tag === "p") && name === "style") {
        const raw = safe(el.getAttribute("style") || "");
        const safeStyle = raw
          .split(";")
          .map((x) => x.trim())
          .filter((x) => /^(text-align|line-height)\s*:/i.test(x))
          .join("; ");
        if (safeStyle) el.setAttribute("style", safeStyle);
        else el.removeAttribute("style");
        return;
      }

      el.removeAttribute(a.name);
    });

    if (tag === "a") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });

  return tmp.innerHTML;
}

function ensureBlockStructure(el) {
  // If user empties content, keep one div so typing behaves
  const html = safe(el.innerHTML || "").trim();
  if (!html) {
    el.innerHTML = "<div><br/></div>";
  }
}

function applySpanToSelection(stylePatch) {
  if (typeof window === "undefined") return false;
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);
  if (!range || range.collapsed) return false;

  const span = document.createElement("span");
  Object.entries(stylePatch || {}).forEach(([k, v]) => {
    if (!v) return;
    span.style[k] = v;
  });

  try {
    range.surroundContents(span);
  } catch {
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }

  // move caret after inserted span
  sel.removeAllRanges();
  const r = document.createRange();
  r.setStartAfter(span);
  r.collapse(true);
  sel.addRange(r);
  return true;
}

const RichTextEditor = forwardRef(function RichTextEditor(
  { value, onChange, blockStyle = {}, placeholder = "Click to edit text..." },
  ref
) {
  const elRef = useRef(null);
  const lastHtmlRef = useRef("");
  const composingRef = useRef(false);

  // Force LTR globally inside the editor
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    el.setAttribute("dir", "ltr");
    el.style.direction = "ltr";
    el.style.unicodeBidi = "isolate";
    el.style.writingMode = "horizontal-tb";
  }, []);

  // Only set innerHTML when NOT focused (prevents collapsing lines while typing)
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const isFocused = document.activeElement === el;
    const incoming = safe(value || "");

    if (!isFocused && incoming !== lastHtmlRef.current) {
      el.innerHTML = incoming || "<div><br/></div>";
      lastHtmlRef.current = incoming;
    }
  }, [value]);

  const pushChange = () => {
    const el = elRef.current;
    if (!el) return;
    ensureBlockStructure(el);
    const cleaned = sanitizeHtml(el.innerHTML);
    lastHtmlRef.current = cleaned;
    onChange?.(cleaned);
  };

  useImperativeHandle(ref, () => ({
    focus: () => elRef.current?.focus?.(),

    // Inline styles apply to selection
    applyInlineStyle: (stylePatch) => {
      const ok = applySpanToSelection(stylePatch || {});
      if (ok) pushChange();
      return ok;
    },

    // Block style is handled by parent (inspector) but we can help
    applyBlockStyle: (patch) => {
      // no direct mutation here — parent should store blockStyle,
      // but we can apply visual immediately:
      const el = elRef.current;
      if (!el) return;
      if (patch?.textAlign) el.style.textAlign = patch.textAlign;
      if (patch?.lineHeight) el.style.lineHeight = String(patch.lineHeight);
    },

    getHtml: () => safe(elRef.current?.innerHTML || ""),
  }));

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      dir="ltr"
      spellCheck
      style={{
        minHeight: 140,
        borderRadius: 12,
        border: "1px solid rgba(148,163,184,0.25)",
        padding: 12,
        outline: "none",
        fontSize: 16,
        background: "#ffffff",
        color: "#0b1120",
        lineHeight: blockStyle?.lineHeight ? String(blockStyle.lineHeight) : "1.6",
        textAlign: blockStyle?.textAlign || "left",
        direction: "ltr",
        unicodeBidi: "isolate",
        writingMode: "horizontal-tb",
        whiteSpace: "normal",
      }}
      onFocus={() => {
        const el = elRef.current;
        if (!el) return;
        ensureBlockStructure(el);
      }}
      onInput={() => {
        if (composingRef.current) return;
        pushChange();
      }}
      onCompositionStart={() => (composingRef.current = true)}
      onCompositionEnd={() => {
        composingRef.current = false;
        pushChange();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain") || "";
        const html = text
          .split("\n")
          .map((line) =>
            line
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
          )
          .join("<br/>");
        document.execCommand("insertHTML", false, html);
      }}
      onKeyDown={(e) => {
        // Keep Enter as a newline, not a single line
        if (e.key === "Enter") {
          // allow default, we keep <div>/<br> in sanitizer
          return;
        }
      }}
      data-placeholder={placeholder}
    />
  );
});

export default RichTextEditor;
