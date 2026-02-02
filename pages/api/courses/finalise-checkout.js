// /pages/api/courses/finalise-checkout.js
// FULL REPLACEMENT
//
// ✅ Verifies Stripe Checkout session is PAID
// ✅ Creates course_entitlements row for the logged-in user
// ✅ Works across your OTHER website too (same DB) because entitlement is stored in Supabase
//
// Body: { courseId, session_id }
//
// ENV required:
// - STRIPE_SECRET_KEY
// - SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: "Invalid session" });
    const user_id = userData.user.id;

    const { courseId, session_id } = req.body || {};
    if (!courseId || !session_id) return res.status(400).json({ error: "Missing courseId/session_id" });

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (!session) return res.status(404).json({ error: "Stripe session not found" });

    // Must be paid
    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: `Payment not completed (status: ${session.payment_status})` });
    }

    const meta = session.metadata || {};
    const paidCourseId = meta.course_id || courseId;
    const scope = meta.scope || "full_course";
    const module_id = meta.module_id || null;
    const paidUserId = meta.user_id || user_id;

    // Prevent granting to wrong user
    if (paidUserId && paidUserId !== user_id) {
      return res.status(403).json({ error: "This checkout session belongs to a different user." });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Insert entitlement (dedupe-safe if you add a unique constraint)
    // Recommended unique index:
    // unique (user_id, course_id, entitlement_type, coalesce(module_id,'00000000-0000-0000-0000-000000000000'))
    const row = {
      user_id,
      course_id: paidCourseId,
      entitlement_type: scope === "module" ? "module" : "full_course",
      module_id: scope === "module" ? module_id : null,
      source: "stripe_checkout",
      stripe_session_id: session_id,
    };

    const { error: insErr } = await admin
      .from("course_entitlements")
      .insert(row);

    // If duplicate, treat as ok
    if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
      console.error(insErr);
      return res.status(500).json({ error: "Failed to grant access" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("finalise-checkout error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
