// scripts/run-worker.js
// Full-file replacement (CommonJS) — loads .env and .env.local then spawns the existing worker script.
// - Use this when your project or shell runs scripts as CommonJS (avoids "import statement outside a module").
// - Loads .env, .env.local and .env.development (if present) from project root.
// - Validates critical env vars and prints clear instructions if missing.
// - Spawns scripts/sendEmailWorker.js in a child Node process so module type mismatches are avoided.
//
// Usage:
//   npm run worker   (if package.json contains "worker": "node scripts/run-worker.js")
//   OR
//   node scripts/run-worker.js
//
// Important: keep your secrets in .env.local (or .env) in the project root and DO NOT commit them.

const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.join(__dirname, "..");

function tryLoadEnvFile(filename) {
  const fullPath = path.join(projectRoot, filename);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
    console.log(`[run-worker] Loaded ${filename}`);
    return true;
  } else {
    console.log(`[run-worker] ${filename} not found (skipping)`);
    return false;
  }
}

// Load .env, then .env.local (overrides), and optional .env.development
tryLoadEnvFile(".env");
tryLoadEnvFile(".env.local");
tryLoadEnvFile(".env.development");

// Resolve required envs (allow common NEXT_PUBLIC fallback for SUPABASE_URL)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";

const missing = [];
if (!SUPABASE_URL) missing.push("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!SENDGRID_API_KEY) missing.push("SENDGRID_API_KEY");

if (missing.length) {
  console.error("\n[run-worker] Missing required environment variables:");
  missing.forEach((m) => console.error("  -", m));
  console.error("\nPlace them in a local .env or .env.local in the project root (next to package.json).");
  console.error("Example .env.local (DO NOT COMMIT):");
  console.error("SUPABASE_URL=https://your-project.supabase.co");
  console.error("SUPABASE_SERVICE_ROLE_KEY=service_role_key_here");
  console.error("SENDGRID_API_KEY=SG.your_sendgrid_key_here");
  process.exit(1);
}

// Path to your worker file (relative to scripts/)
const workerPath = path.join(__dirname, "sendEmailWorker.js");

// Spawn the worker in a child Node process, passing current env
const child = spawn(process.execPath, [workerPath], {
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.log(`[run-worker] Worker exited with signal ${signal}`);
    process.exit(1);
  } else {
    console.log(`[run-worker] Worker exited with code ${code}`);
    process.exit(code ?? 0);
  }
});

child.on("error", (err) => {
  console.error("[run-worker] Failed to start worker:", err && err.message ? err.message : err);
  process.exit(1);
});