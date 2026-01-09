// /pages/api/autoresponders/save.js
// FULL REPLACEMENT — Save autoresponder HTML into Supabase Storage (NOT local filesystem)
//
// ✅ Works in production (Vercel/etc) — no fs writes
// ✅ Stores HTML into bucket: email-user-assets
// ✅ Returns { ok:true, path, publicUrl }
// ✅ Optional: if meta.autoresponder_id is provided, updates email_automations.template_path to the saved Storage path
// ✅ Uses service role (server-side) so it always saves

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = "email-user-assets";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function slugify(v) {
  return String(v || "autoresponder")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "autoresponder";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = req.body || {};
    const { meta, html, status } = body;

    if (!meta || !html) {
      return res.status(400).json({ ok: false, error: "Missing meta or html" });
    }

    // Use a stable-ish name from meta (supports your existing editor payload)
    const baseName =
      meta.campaignsName ||
      meta.autoresponderName ||
      meta.name ||
      meta.title ||
      "autoresponder";

    const slug = slugify(baseName);
    const stamp = Date.now();

    // Store under a folder so list-saved-emails can discover it
    // (If your list endpoint expects a different folder, change ONLY this prefix)
    const storagePath = `saved-emails/autoresponders/${slug}-${stamp}.html`;

    const bytes = Buffer.from(String(html), "utf8");

    // Upload (upsert=false to avoid overwriting)
    const up = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: "text/html; charset=utf-8",
        upsert: false,
      });

    if (up.error) {
      return res.status(500).json({ ok: false, error: up.error.message });
    }

    // Public URL (even if bucket is private, it’s still useful to return the path)
    const pub = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = pub?.data?.publicUrl || null;

    // Optional: update the autoresponder record with this template path
    const autoresponder_id = meta.autoresponder_id || meta.autoresponderId || null;
    if (autoresponder_id) {
      const upd = await supabaseAdmin
        .from("email_automations")
        .update({
          template_path: storagePath,
          template_id: null, // prevent UUID mismatch issues
          status: status === "active" ? "active" : "draft",
        })
        .eq("id", autoresponder_id);

      if (upd.error) {
        // Don’t fail the save (the HTML is already uploaded)
        return res.status(200).json({
          ok: true,
          path: storagePath,
          publicUrl,
          warning: "Saved HTML, but failed to update email_automations: " + upd.error.message,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      path: storagePath,
      publicUrl,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
