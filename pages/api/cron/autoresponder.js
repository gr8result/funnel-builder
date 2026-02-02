// /pages/api/cron/autoresponder.js
// API endpoint to trigger autoresponder queue processing (for cron jobs or uptime monitors)
// POST or GET to this endpoint will trigger the autoresponder queue processor

export default async function handler(req, res) {
  // Forward the request to the actual process-queue endpoint
  const url = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/email/autoresponders/process-queue`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AUTORESPONDER_CRON_SECRET ? { 'x-cron-key': process.env.AUTORESPONDER_CRON_SECRET } : {})
      }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
