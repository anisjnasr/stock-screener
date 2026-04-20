#!/usr/bin/env node
/**
 * POST /api/cron/economic-calendar (Forex Factory → Supabase).
 *
 * Loads optional `.env.local` from repo root (same pattern as go-live-preflight).
 *
 * Usage:
 *   npm run economic-calendar:trigger
 *   npm run economic-calendar:trigger -- --url https://your-app.onrender.com
 *
 * Env (or .env.local):
 *   CRON_SECRET   — required; Bearer token (must match server)
 *   APP_BASE_URL  — optional; origin only, default http://localhost:3000
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadEnvLocal();

const args = process.argv.slice(2);
let urlOverride = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url" && args[i + 1]) {
    urlOverride = args[i + 1];
    i++;
  }
}

const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("Missing CRON_SECRET (set in environment or .env.local).");
  process.exit(1);
}

const rawBase = (urlOverride || process.env.APP_BASE_URL || "http://localhost:3000").trim().replace(/\/$/, "");
const endpoint = `${rawBase}/api/cron/economic-calendar`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    Accept: "application/json",
  },
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = null;
}

console.log(`POST ${endpoint}`);
console.log(`HTTP ${res.status}`);
if (json) console.log(JSON.stringify(json, null, 2));
else console.log(text);

if (!res.ok || !json?.ok) {
  process.exit(1);
}
