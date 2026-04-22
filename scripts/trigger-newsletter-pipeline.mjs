#!/usr/bin/env node
/**
 * Smoke test Phase 4: POST newsletter-ingest, then POST macro-writeup (same order as crons).
 *
 * Loads optional `.env.local` from repo root.
 *
 * Usage:
 *   npm run newsletter:pipeline:trigger
 *   npm run newsletter:pipeline:trigger -- --url https://your-app.onrender.com
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

async function post(path) {
  const endpoint = `${rawBase}${path}`;
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
  return { endpoint, res, json, text };
}

console.log(`Base: ${rawBase}\n`);

const ingest = await post("/api/cron/newsletter-ingest");
console.log(`POST ${ingest.endpoint}`);
console.log(`HTTP ${ingest.res.status}`);
if (ingest.json) console.log(JSON.stringify(ingest.json, null, 2));
else console.log(ingest.text);

if (!ingest.res.ok || !ingest.json?.ok) {
  console.error("\n:: Ingest failed — fix before macro step.");
  process.exit(1);
}

console.log("\n--- macro writeup ---\n");

const macro = await post("/api/cron/macro-writeup");
console.log(`POST ${macro.endpoint}`);
console.log(`HTTP ${macro.res.status}`);
if (macro.json) console.log(JSON.stringify(macro.json, null, 2));
else console.log(macro.text);

if (!macro.res.ok || !macro.json?.ok) {
  console.error("\n:: Macro writeup failed.");
  process.exit(1);
}

console.log("\n:: Phase 4 pipeline smoke test OK (ingest + macro).");
