#!/usr/bin/env node
/**
 * POST earnings crons (universe → ingest → actuals) in order.
 *
 * Loads optional `.env.local` from repo root (same pattern as trigger-economic-calendar.mjs).
 *
 * Usage:
 *   npm run earnings:trigger
 *   npm run earnings:trigger -- --url https://your-app.onrender.com
 *   npm run earnings:trigger -- --only universe
 *   npm run earnings:trigger -- --only ingest --url http://localhost:3001
 *
 * Env (or .env.local):
 *   CRON_SECRET   — required; Bearer token (must match server)
 *   APP_BASE_URL — optional; origin only, default http://localhost:3000
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
let only = "all";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url" && args[i + 1]) {
    urlOverride = args[i + 1];
    i++;
  } else if (args[i] === "--only" && args[i + 1]) {
    only = args[i + 1].toLowerCase();
    i++;
  }
}

const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("Missing CRON_SECRET (set in environment or .env.local).");
  process.exit(1);
}

const rawBase = (urlOverride || process.env.APP_BASE_URL || "http://localhost:3000").trim().replace(/\/$/, "");

const PATHS = [
  { name: "universe", path: "/api/cron/earnings/universe" },
  { name: "ingest", path: "/api/cron/earnings/ingest" },
  { name: "actuals", path: "/api/cron/earnings/actuals" },
];

const selected =
  only === "all"
    ? PATHS
    : PATHS.filter((p) => p.name === only);

if (!selected.length) {
  console.error(`Unknown --only "${only}". Use universe | ingest | actuals | all`);
  process.exit(1);
}

for (const { name, path: p } of selected) {
  const endpoint = `${rawBase}${p}`;
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

  console.log(`\nPOST ${endpoint}`);
  console.log(`HTTP ${res.status}`);
  if (json) console.log(JSON.stringify(json, null, 2));
  else console.log(text.slice(0, 500));

  if (!res.ok || !json?.ok) {
    if (res.status === 404 && /not found|404/i.test(text)) {
      console.error(
        "\nHint: Got HTML/404 — this server build may not include /api/cron/earnings/*. Deploy the latest commit, then retry."
      );
    }
    process.exit(1);
  }
}

console.log("\nAll requested earnings crons completed successfully.");
