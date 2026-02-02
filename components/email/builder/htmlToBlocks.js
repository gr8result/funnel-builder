// ============================================
// /components/email/builder/htmlToBlocks.js
// Convert HTML templates into editable blocks (one-time import)
// ============================================

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

function cleanText(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripToText(html) {
  return cleanText(
    String(html || "")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

export function htmlToBlocks(html) {
  const src = String(html || "");
  const imgRegex = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let last = 0;
  let m;
  const parts = [];

  while ((m = imgRegex.exec(src)) !== null) {
    const before = src.slice(last, m.index);
    const img = m[1];
    parts.push({ t: "html", v: before });
    parts.push({ t: "img", v: img });
    last = imgRegex.lastIndex;
  }
  parts.push({ t: "html", v: src.slice(last) });

  const blocks = [];

  // Always start with a header block (editable)
  blocks.push({
    id: makeId("header"),
    type: "header",
    style: { padding: 18, align: "center" },
    content: { title: "GR8 RESULT", subtitle: "Your next campaigns starts here" },
  });

  for (const p of parts) {
    if (p.t === "img") {
      const url = String(p.v || "").trim();
      if (!url) continue;
      blocks.push({
        id: makeId("image"),
        type: "image",
        style: { padding: 18, align: "center" },
        content: { image: url, width: 100, radius: 0 },
      });
    } else {
      const txt = stripToText(p.v);
      if (!txt) continue;
      blocks.push({
        id: makeId("text"),
        type: "text",
        style: { padding: 18, align: "left" },
        content: { text: txt },
      });
    }
  }

  // Footer
  blocks.push({
    id: makeId("footer"),
    type: "footer",
    style: { padding: 18, align: "center" },
    content: { text: "© GR8 RESULT — All rights reserved." },
  });

  return blocks;
}
