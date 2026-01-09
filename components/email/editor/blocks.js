// /components/email/editor/blocks.js
// FULL REPLACEMENT — fixes insertion point + provides real blocks (incl resizable image + 2/3 columns)

export function normalizeCanvasHtml(html) {
  const s = String(html || "").trim();
  if (!s) return "";
  // strip full document wrappers if pasted
  return s
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<html[\s\S]*?>/gi, "")
    .replace(/<\/html>/gi, "")
    .replace(/<head[\s\S]*?>[\s\S]*?<\/head>/gi, "")
    .replace(/<body[\s\S]*?>/gi, "")
    .replace(/<\/body>/gi, "")
    .trim();
}

export function ensureCanvasHasRoot(canvas) {
  if (!canvas) return;
  // ensure there is always at least one paragraph so cursor can exist
  if (!canvas.firstChild) {
    const p = document.createElement("p");
    p.innerHTML = "<br/>";
    canvas.appendChild(p);
  }
}

function blockBase(type) {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-block", type);
  wrap.style.margin = "10px 0";
  wrap.style.padding = "10px 12px";
  wrap.style.border = "1px solid rgba(148,163,184,0.22)";
  wrap.style.borderRadius = "14px";
  wrap.style.background = "rgba(255,255,255,0.02)";
  return wrap;
}

export function makeBlock(type) {
  if (typeof document === "undefined") return null;

  if (type === "text") {
    const w = blockBase("text");
    w.style.borderStyle = "dashed";
    w.innerHTML = `<p style="margin:0;">Type your text…</p>`;
    return w;
  }

  if (type === "button") {
    const w = blockBase("button");
    w.style.display = "flex";
    w.style.justifyContent = "center";
    w.innerHTML = `
      <a href="#" style="
        display:inline-block;
        background:#2563eb;
        color:#fff;
        font-weight:900;
        padding:12px 18px;
        border-radius:12px;
        text-decoration:none;
      ">Button</a>
    `;
    return w;
  }

  if (type === "divider") {
    const w = blockBase("divider");
    w.style.padding = "14px 12px";
    w.innerHTML = `<div style="height:2px;background:#e5e7eb;border-radius:999px;"></div>`;
    return w;
  }

  if (type === "spacer") {
    const w = blockBase("spacer");
    w.style.padding = "0";
    w.innerHTML = `<div style="height:28px;"></div>`;
    return w;
  }

  if (type === "columns2" || type === "columns3") {
    const cols = type === "columns3" ? 3 : 2;
    const w = blockBase(type);
    w.style.padding = "12px";
    w.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:12px;">
        ${Array.from({ length: cols })
          .map(
            () => `
          <div data-col="1" style="border:1px dashed rgba(148,163,184,0.45);border-radius:14px;padding:12px;min-height:80px;">
            <p style="margin:0;color:#111827;">Column…</p>
          </div>
        `
          )
          .join("")}
      </div>
    `;
    return w;
  }

  if (type === "image") {
    const w = blockBase("image");
    w.style.borderStyle = "dashed";

    // RESIZE: wrapper has resize:both and overflow hidden (user can drag corner)
    w.innerHTML = `
      <div class="imgWrap" data-w="320" data-align="center" style="
        width:320px;
        max-width:320px;
        margin:10px auto;
        resize: both;
        overflow: hidden;
        border-radius: 14px;
        border: 1px solid rgba(148,163,184,0.25);
        background: rgba(2,6,23,0.03);
      ">
        <div class="imgHint" style="
          padding: 18px 14px;
          font-weight: 900;
          color: #475569;
          text-align:center;
        ">Click an image in the library to insert</div>
        <img src="" alt="" style="display:block;width:100%;height:auto;" />
      </div>
      <div style="font-size:12px;font-weight:900;color:#64748b;margin-top:6px;">
        Tip: drag the bottom-right corner of the image box to resize.
      </div>
    `;
    return w;
  }

  if (type === "social") {
    const w = blockBase("social");
    w.style.display = "flex";
    w.style.justifyContent = "center";
    w.style.gap = "10px";
    w.innerHTML = `
      ${["Facebook", "Instagram", "LinkedIn", "X"].map(
        (n) => `<a href="#" style="font-weight:900;color:#2563eb;text-decoration:none;">${n}</a>`
      ).join("")}
    `;
    return w;
  }

  if (type === "html") {
    const w = blockBase("html");
    w.style.borderStyle = "dashed";
    w.innerHTML = `<div style="font-weight:900;color:#111827;">HTML block</div><div style="font-size:12px;color:#64748b;font-weight:800;">Paste HTML here</div>`;
    return w;
  }

  // fallback
  const w = blockBase(type);
  w.innerHTML = `<p style="margin:0;">${type}</p>`;
  return w;
}

// Finds nearest insertion point based on existing blocks (data-block wrappers)
export function findInsertionPoint(canvas, clientY) {
  const blocks = Array.from(canvas.querySelectorAll(":scope > [data-block], :scope > div[data-block]"));
  if (!blocks.length) return { ref: null, before: true, lineY: 22 };

  let best = { ref: blocks[0], before: true, dist: Infinity, lineY: 22 };

  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const dist = Math.abs(clientY - mid);
    const before = clientY < mid;
    const lineY = before ? r.top - canvas.getBoundingClientRect().top : r.bottom - canvas.getBoundingClientRect().top;

    if (dist < best.dist) best = { ref: el, before, dist, lineY };
  }

  // convert lineY to canvasOuter positioning space:
  // caller uses absolute inside canvasOuter; we just return a reasonable lineY
  return { ref: best.ref, before: best.before, lineY: Math.max(18, best.lineY + 24) };
}
