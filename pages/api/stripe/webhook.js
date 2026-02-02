import Stripe from "stripe";
import getRawBody from "raw-body";
import sgMail from "@sendgrid/mail";

export const config = {
  api: {
    bodyParser: false, // REQUIRED for Stripe
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ We only care about successful payments
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      const email = session.customer_details?.email;
      const amount = (session.amount_total || 0) / 100;
      const currency = session.currency?.toUpperCase();
      const sessionId = session.id;
      const metadata = session.metadata || {};

      const msg = {
        to: process.env.ADMIN_NOTIFICATION_EMAIL,
        from: process.env.ADMIN_NOTIFICATION_EMAIL,
        subject: `✅ Course Purchase: ${metadata.course_title || "Unknown Course"}`,
        text: `
A course purchase was completed.

Email: ${email}
Course: ${metadata.course_title || "N/A"}
Amount: ${amount} ${currency}
Stripe Session ID: ${sessionId}

Grant access manually on the external website.
        `,
      };

      await sgMail.send(msg);

      console.log("✅ Purchase notification email sent");
    } catch (err) {
      console.error("❌ Failed to send notification email", err);
    }
  }

  res.json({ received: true });
}

