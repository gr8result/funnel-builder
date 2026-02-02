// /pages/api/courses/create-checkout-session.js
// FULL REPLACEMENT
//
// ✅ Creates Stripe Checkout Session for COURSE purchases (one-time payment)
// ✅ Uses STRIPE_SECRET_KEY (must be sk_live_... or sk_test_...)
// ✅ Auth: requires Supabase Bearer token
// ✅ Metadata includes: gr8_type=course_purchase, courseId, scope, moduleId, userId
// ✅ Success returns user back to /modules/courses/[courseId]/learn?success=1

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is missing`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    requireEnv("STRIPE_SECRET_KEY", STRIPE_SECRET_KEY);
    if (!STRIPE_SECRET_KEY.startsWith("sk_")) {
      return res.status(400).json({
        ok: false,
        error: "STRIPE_SECRET_KEY must be an sk_... secret key (NOT rk_...).",
      });
    }
    requireEnv("NEXT_PUBLIC_SITE_URL", SITE_URL);
    requireEnv("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)", SUPABASE_URL);
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)", SUPABASE_ANON_KEY);

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });

    // Validate the user (multi-tenant safe)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    const userId = userRes.user.id;

    const { courseId, scope, moduleId } = req.body || {};
    if (!courseId) return res.status(400).json({ ok: false, error: "courseId is required" });

    const normalizedScope = scope === "module" ? "module" : "full_course";
    const normalizedModuleId = normalizedScope === "module" ? (moduleId || null) : null;

    // Fetch course + module titles for clean line item names
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("id,title,price_aud")
      .eq("id", courseId)
      .single();

    if (courseErr || !course) {
      return res.status(404).json({ ok: false, error: "Course not found" });
    }

    let displayName = course.title || "Course";
    let amountAud = Number(course.price_aud || 0);

    if (normalizedScope === "module") {
      const { data: mod, error: modErr } = await supabase
        .from("course_modules")
        .select("id,title,price_aud")
        .eq("id", normalizedModuleId)
        .eq("course_id", courseId)
        .single();

      if (modErr || !mod) {
        return res.status(404).json({ ok: false, error: "Module not found for this course" });
      }

      displayName = `${course.title || "Course"} — ${mod.title || "Module"}`;
      amountAud = Number(mod.price_aud || 0);
    }

    if (!amountAud || isNaN(amountAud) || amountAud <= 0) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing price. Set courses.price_aud (and course_modules.price_aud for modules).",
      });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

    const successUrl = `${SITE_URL}/modules/courses/${courseId}/learn?success=1`;
    const cancelUrl = `${SITE_URL}/modules/courses/${courseId}/learn?cancel=1`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: displayName },
            unit_amount: Math.round(amountAud * 100),
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        gr8_type: "course_purchase",
        courseId: String(courseId),
        scope: normalizedScope,
        moduleId: normalizedModuleId ? String(normalizedModuleId) : "",
        userId: String(userId),
        course_title: String(course.title || "Course"),
      },
    });

    return res.status(200).json({ ok: true, id: session.id, url: session.url });
  } catch (e) {
    console.error("create-checkout-session error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
