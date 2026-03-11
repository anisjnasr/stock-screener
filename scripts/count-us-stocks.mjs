#!/usr/bin/env node
/**
 * Count US stocks by type via Polygon/Massive API.
 * We only care about CS, ADRC, and ETF; other types are ignored in the app.
 * Saves counts to scripts/stock-type-counts.json.
 * Run: node scripts/count-us-stocks.mjs  or  npm run count-stocks
 * Requires MASSIVE_API_KEY in .env.local or environment.
 */

const ALLOWED_TYPES = new Set(["CS", "ADRC", "ETF"]);

import { readFileSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

loadEnvLocal();

const API_KEY = process.env.MASSIVE_API_KEY;
if (!API_KEY) {
  console.error("Missing MASSIVE_API_KEY. Set it in .env.local or the environment.");
  process.exit(1);
}

const BASE = "https://api.polygon.io";
const OUTPUT_PATH = join(__dirname, "stock-type-counts.json");

async function countUsStocksByType() {
  const byType = {};
  let total = 0;
  let nextUrl = `${BASE}/v3/reference/tickers?market=stocks&active=true&limit=1000&order=ticker&sort=ticker&apiKey=${API_KEY}`;

  console.log("Fetching US stocks (market=stocks, active=true)...\n");

  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) {
      console.error("API error:", res.status, await res.text());
      process.exit(1);
    }
    const data = await res.json();
    const results = data.results ?? [];

    for (const r of results) {
      const type = (r.type && String(r.type).trim()) || "unknown";
      byType[type] = (byType[type] || 0) + 1;
    }

    total += results.length;
    nextUrl = data.next_url ? `${data.next_url}&apiKey=${API_KEY}` : null;

    process.stdout.write(`  Fetched ${total} tickers so far...\r`);
  }

  console.log("\n");
  return { total, byType };
}

const { total, byType } = await countUsStocksByType();

const cs = byType["CS"] ?? 0;
const adrc = byType["ADRC"] ?? 0;
const etf = byType["ETF"] ?? 0;
const inScopeTotal = cs + adrc + etf;

const out = {
  fetchedAt: new Date().toISOString(),
  totalFetched: total,
  inScopeTotal,
  byType,
  inScope: { CS: cs, ADRC: adrc, ETF: etf },
};

writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), "utf8");

console.log("Total tickers fetched (market=stocks, active=true):", total);
console.log("In-scope only (CS + ADRC + ETF):", inScopeTotal);
console.log("  CS:", cs);
console.log("  ADRC:", adrc);
console.log("  ETF:", etf);
console.log("\nSaved to:", OUTPUT_PATH);
