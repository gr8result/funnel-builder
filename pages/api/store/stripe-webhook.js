// pages/api/store/stripe-webhook.js
// Webhook just for STORE checkouts (not your SaaS module billing)

import Stripe from "stripe";
import { buffer } from "micro";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const appCheckoutSessionId = session.metadata?.app_checkout_session_id;
    const appUserId = session.metadata?.app_user_id;
    const appContactId = session.metadata?.app_contact_id;
    const appProductId = session.metadata?.app_product_id;

    try {
      // 1) Mark our checkout_session as completed
      if (appCheckoutSessionId) {
        await supabase
          .from("checkout_sessions")
          .update({
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", appCheckoutSessionId);
      }

      // 2) Insert order row in orders table
      const amountCents = session.amount_total || 0;
      const currency = (session.currency || "aud").toUpperCase();

      await supabase.from("orders").insert({
        user_id: appUserId,
        amount_cents: amountCents,
        currency,
        status: "paid",
        created_at: new Date().toISOString(),
      });

      // 3) Log automation event
      if (appContactId) {
        await supabase.from("automation_events").insert({
          contact_id: appContactId,
          event_type: "order_completed",
          payload: {
            product_id: appProductId,
            amount_cents: amountCents,
            currency,
            stripe_session_id: session.id,
          },
        });

        // 4) Trigger automation flows with purchase_completed trigger
        try {
          await fetch(
            `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/automation/webhook/purchase-completed`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lead_id: appContactId,
                email: session.customer_email || session.customer_details?.email,
                order_id: session.id,
                amount: amountCents / 100,
              }),
            }
          );
        } catch (webhookErr) {
          console.error("Error calling purchase-completed webhook:", webhookErr);
          // Don't fail the main webhook if automation fails
        }
      }
    } catch (err) {
      console.error("Error handling store checkout.session.completed:", err);
    }
  }

  res.json({ received: true });
}
