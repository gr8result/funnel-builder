// /pages/api/courses/webhook.js
// FULL REPLACEMENT
//
// ✅ Stripe webhook for COURSE purchases ONLY
// ✅ Env:
//    STRIPE_SECRET_KEY=sk_live_...
//    STRIPE_COURSES_WEBHOOK_SECRET=whsec_live_...
//    NEXT_PUBLIC_SUPABASE_URL
//    SUPABASE_SERVICE_ROLE_KEY
//
// ✅ When checkout.session.completed:
//    - reads metadata: gr8_type=course_purchase, courseId, scope, moduleId, userId
//    - inserts into course_entitlements (full_course OR module)
//    - upserts course_enrolments (optional, safe if table exists)

import Stripe from "stripe";
import { buffer } from "micro";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false },
};

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_COURSES_WEBHOOK_SECRET || "";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function must(name, v) {
  if (!v) throw new Error(`${name} is missing`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  try {
    must("STRIPE_SECRET_KEY", STRIPE_SECRET_KEY);
    must("STRIPE_COURSES_WEBHOOK_SECRET", WEBHOOK_SECRET);
    must("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
    const sig = req.headers["stripe-signature"];
    const buf = await buffer(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(buf, sig, WEBHOOK_SECRET);
    } catch (err) {
      console.error("❌ Courses webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Only care about completed payments for now
    if (event.type !== "checkout.session.completed") {
      return res.json({ received: true });
    }

    const session = event.data.object;
    const meta = session.metadata || {};

    if (meta.gr8_type !== "course_purchase") {
      // Not ours — ignore quietly
      return res.json({ received: true });
    }

    const courseId = meta.courseId || null;
    const scope = meta.scope || null; // full_course | module
    const moduleId = meta.moduleId || null;
    const userId = meta.userId || null;

    if (!courseId || !scope || !userId) {
      console.error("❌ Missing course purchase metadata:", meta);
      return res.json({ received: true });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Grant entitlement
    if (scope === "full_course") {
      const { error } = await supabaseAdmin.from("course_entitlements").upsert(
        {
          course_id: courseId,
          user_id: userId,
          module_id: null,
          entitlement_type: "full_course",
        },
        { onConflict: "course_id,user_id,entitlement_type" }
      );

      if (error) console.error("❌ course_entitlements full_course error:", error);
      else console.log("✅ Full course entitlement granted:", { courseId, userId });
    }

    if (scope === "module" && moduleId) {
      const { error } = await supabaseAdmin.from("course_entitlements").upsert(
        {
          course_id: courseId,
          user_id: userId,
          module_id: moduleId,
          entitlement_type: "module",
        },
        { onConflict: "course_id,user_id,module_id,entitlement_type" }
      );

      if (error) console.error("❌ course_entitlements module error:", error);
      else console.log("✅ Module entitlement granted:", { courseId, moduleId, userId });
    }

    // 2) Optional enrolment record (won’t crash if table missing)
    try {
      await supabaseAdmin.from("course_enrolments").upsert(
        {
          course_id: courseId,
          user_id: userId,
          access_level: scope === "full_course" ? "full" : "modules",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "course_id,user_id" }
      );
    } catch (e) {
      // ignore if table doesn't exist
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("🔥 Courses webhook error:", e);
    return res.status(500).send("Internal webhook error");
  }
}
