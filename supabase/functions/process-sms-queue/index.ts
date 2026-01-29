// /supabase/functions/process-sms-queue/index.ts
// FULL REPLACEMENT — NEVER CRASHES + SMSGlobal send + timeouts
// ✅ Strong outer try/catch so Edge Function always returns JSON
// ✅ Calls Next.js API endpoint /api/smsglobal/flush-queue
// ✅ Handles authentication via CRON_SECRET
// ✅ Hard timeouts so requests never spin forever
// ✅ CORS + OPTIONS

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(origin: string | null, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

function clean(v: unknown) {
  return String(v ?? "").trim();
}

function nowISO() {
  return new Date().toISOString();
}

function getEnvAny(keys: string[]) {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

const FLUSH_TIMEOUT_MS = 25000; // 25 seconds for flush endpoint
const BATCH_LIMIT = 50;

serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors(origin) });
  }

  if (req.method !== "POST") {
    return json(origin, 405, { ok: false, error: "Use POST" });
  }

  try {
    // ---- auth (cron secret) ----
    const expectedSecret = getEnvAny(["CRON_SECRET", "AUTOMATION_CRON_KEY"]);
    const gotSecret = clean(req.headers.get("x-cron-secret"));

    if (!expectedSecret) {
      return json(origin, 500, {
        ok: false,
        error: "Missing CRON_SECRET in Supabase Function secrets",
      });
    }
    if (gotSecret !== expectedSecret) {
      return json(origin, 401, { ok: false, error: "Unauthorized" });
    }

    // ---- env ----
    const NEXT_API_URL = getEnvAny([
      "NEXT_PUBLIC_SITE_URL",
      "SITE_URL",
      "PUBLIC_SITE_URL",
    ]);

    if (!NEXT_API_URL) {
      return json(origin, 500, {
        ok: false,
        error: "Missing NEXT_PUBLIC_SITE_URL (or SITE_URL) in Supabase Function secrets",
      });
    }

    // Build flush queue endpoint URL
    const flushUrl = `${NEXT_API_URL}/api/smsglobal/flush-queue?key=${encodeURIComponent(
      expectedSecret
    )}&limit=${BATCH_LIMIT}`;

    console.log(`[${nowISO()}] Calling flush-queue endpoint: ${flushUrl}`);

    // Call the Next.js API endpoint
    const flushResponse = await fetchWithTimeout(
      flushUrl,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      FLUSH_TIMEOUT_MS
    );

    const responseText = await flushResponse.text();
    let flushResult;

    try {
      flushResult = JSON.parse(responseText);
    } catch (parseErr) {
      console.error("Failed to parse flush-queue response:", responseText);
      return json(origin, 500, {
        ok: false,
        error: "Invalid response from flush-queue endpoint",
        detail: responseText.slice(0, 500),
      });
    }

    if (!flushResponse.ok) {
      console.error(
        `flush-queue returned ${flushResponse.status}:`,
        flushResult
      );
      return json(origin, flushResponse.status, {
        ok: false,
        error: "flush-queue endpoint failed",
        detail: flushResult,
      });
    }

    console.log(
      `[${nowISO()}] flush-queue success: processed=${
        flushResult?.processed || 0
      }, sent=${flushResult?.sent || 0}, failed=${flushResult?.failed || 0}`
    );

    return json(origin, 200, {
      ok: true,
      timestamp: nowISO(),
      processed: flushResult?.processed || 0,
      sent: flushResult?.sent || 0,
      failed: flushResult?.failed || 0,
      results: flushResult?.results || [],
    });
  } catch (e) {
    // ✅ absolutely never crash
    const msg = clean((e as any)?.message || e || "Unknown crash");
    console.error(`[${nowISO()}] process-sms-queue error:`, msg);
    return json(origin, 500, { ok: false, error: msg, timestamp: nowISO() });
  }
});
