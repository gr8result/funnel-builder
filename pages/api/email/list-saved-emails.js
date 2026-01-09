// /pages/api/email/list-saved-emails.js
// FULL REPLACEMENT
// ✅ Bulletproof recursive scan of Supabase Storage for premade emails (.html)
// ✅ Works with deeply nested structures like:
//    finished-emails/<uuid>/email-editor/finished-emails/<file>.html
// ✅ Finds any .html where path includes "/finished-emails/" or "/user-templates/"

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bucket = String(req.query.bucket || "email-user-assets");
    const maxDepth = clampInt(req.query.maxDepth, 10, 2, 30);
    const maxFiles = clampInt(req.query.maxFiles, 4000, 50, 20000);

    const files = await scanBucketForPremadeHtml(supabaseAdmin, bucket, {
      maxDepth,
      maxFiles,
    });

    files.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      ok: true,
      bucket,
      prefixes: ["finished-emails", "user-templates"],
      count: files.length,
      files,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e || "Unknown error"),
    });
  }
}

function clampInt(v, def, min, max) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
  return def;
}

function safeStr(v) {
  return String(v ?? "");
}

function isFolderItem(item) {
  // Supabase storage list(): folders often have null metadata; files usually have metadata with mimetype/size
  const md = item?.metadata;
  const name = safeStr(item?.name).trim();
  const hasMime = !!md?.mimetype;
  const hasSize = typeof md?.size === "number" || !!md?.size;
  const looksLikeFile = name.includes(".");
  return !hasMime && !hasSize && !looksLikeFile;
}

function pathIsPremade(path) {
  const p = `/${safeStr(path).replace(/^\/+/, "")}`;
  return p.includes("/finished-emails/") || p.includes("/user-templates/");
}

function prettyName(filename) {
  const base = safeStr(filename).replace(/\.html$/i, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function scanBucketForPremadeHtml(supabaseAdmin, bucket, { maxDepth, maxFiles }) {
  const out = [];
  const seen = new Set();

  // breadth-first scan from root
  const q = [{ prefix: "", depth: 0 }];

  while (q.length > 0) {
    const { prefix, depth } = q.shift();

    // IMPORTANT: list() wants "" for root
    const listPrefix = prefix ? prefix : "";

    const { data, error } = await supabaseAdmin.storage.from(bucket).list(listPrefix, {
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      // skip branch instead of crashing
      continue;
    }

    for (const item of data || []) {
      const name = safeStr(item?.name).trim();
      if (!name) continue;

      const fullPath = prefix ? `${prefix}/${name}` : name;

      // file
      if (name.toLowerCase().endsWith(".html")) {
        if (pathIsPremade(fullPath)) {
          const id = fullPath; // store this as template_id
          if (!seen.has(id)) {
            seen.add(id);
            out.push({
              id,
              name: prettyName(name),
              filename: name,
              path: fullPath,
            });
            if (out.length >= maxFiles) return out;
          }
        }
        continue;
      }

      // folder
      if (depth < maxDepth && isFolderItem(item)) {
        q.push({ prefix: fullPath, depth: depth + 1 });
      }
    }
  }

  return out;
}
