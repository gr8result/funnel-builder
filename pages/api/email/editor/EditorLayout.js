// pages/api/email/editor/EditorLayout.js
// ✅ FULL REPLACEMENT
// This path was incorrectly used for a React component previously.
// It MUST be a valid API route file.
// We return 410 Gone so nothing breaks if something still calls it.

export default function handler(req, res) {
  res.status(410).json({
    ok: false,
    error:
      "This endpoint was removed. The Email Editor UI lives under /pages/modules/email/editor (not /api).",
  });
}
