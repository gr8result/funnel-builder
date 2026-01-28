import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    // Only accept POST
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).send("Method Not Allowed");
    }

    // SendGrid sends an array of events. Normalize into an array.
    let events = req.body;
    if (!Array.isArray(events)) events = [events];
    if (!events.length) return res.status(400).json({ error: "No events in request body" });

    // Map SendGrid events to the columns in email_events
    const rows = events.map((ev) => ({
      event: ev.event ?? ev.type ?? null,
      url: ev.url ?? null,
      ts: ev.timestamp ? new Date(Number(ev.timestamp) * 1000).toISOString() : new Date().toISOString(),
    }));

    // Insert rows into email_events
    const { data, error } = await supabase.from("email_events").insert(rows).select("id");
    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "DB insert failed", detail: error.message || error });
    }

    return res.status(200).json({ ok: true, inserted: Array.isArray(data) ? data.length : 0 });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}