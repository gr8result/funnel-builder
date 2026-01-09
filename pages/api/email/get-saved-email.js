// /pages/api/email/get-saved-email.js
// FULL REPLACEMENT
// GET /api/email/get-saved-email?path=<storage-path>
// Returns raw HTML from Supabase Storage (bucket: email-user-assets)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = "email-user-assets";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("GET only");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res
        .status(500)
        .send("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const path = (req.query?.path || "").toString().trim();
    if (!path) return res.status(400).send("Missing ?path=");

    // safety
    if (path.includes("..")) return res.status(400).send("Invalid path");

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);

    if (error || !data) return res.status(404).send(error?.message || "Not found");

    const ab = await data.arrayBuffer();
    const html = Buffer.from(ab).toString("utf8");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send(e?.message || "Server error");
  }
}
