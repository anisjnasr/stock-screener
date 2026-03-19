#!/usr/bin/env node
/**
 * Build local database of all stocks (CS + ADRC only from Massive/Polygon).
 * Fetches reference tickers, keeps only type CS and ADRC, saves to data/all-stocks.json.
 * Run: node scripts/build-stocks-db.mjs  or  npm run build-stocks-db
 * Requires MASSIVE_API_KEY in .env.local or environment.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const OUTPUT_PATH = join(DATA_DIR, "all-stocks.json");

const STOCK_TYPES = new Set(["CS", "ADRC"]);

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

async function buildStocksDb() {
  const stocks = [];
  let nextUrl = `${BASE}/v3/reference/tickers?market=stocks&active=true&limit=1000&order=ticker&sort=ticker&apiKey=${API_KEY}`;

  console.log("Fetching US stocks (market=stocks, active=true), keeping CS + ADRC only...\n");

  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) {
      console.error("API error:", res.status, await res.text());
      process.exit(1);
    }
    const data = await res.json();
    const results = data.results ?? [];

    for (const r of results) {
      const type = (r.type && String(r.type).trim()) || "";
      if (!STOCK_TYPES.has(type)) continue;

      stocks.push({
        symbol: String(r.ticker ?? "").toUpperCase(),
        name: r.name != null ? String(r.name) : "",
        type,
        exchange: r.primary_exchange != null ? String(r.primary_exchange) : undefined,
        currency: r.currency_name != null ? String(r.currency_name) : undefined,
        ipo_date: r.list_date != null ? String(r.list_date) : undefined,
        shares_outstanding:
          r.share_class_shares_outstanding != null
            ? Number(r.share_class_shares_outstanding)
            : r.weighted_shares_outstanding != null
              ? Number(r.weighted_shares_outstanding)
              : undefined,
      });
    }

    nextUrl = data.next_url ? `${data.next_url}&apiKey=${API_KEY}` : null;
    process.stdout.write(`  Fetched ${stocks.length} stocks (CS + ADRC) so far...\r`);
  }

  console.log("\n");

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const out = {
    builtAt: new Date().toISOString(),
    count: stocks.length,
    types: ["CS", "ADRC"],
    stocks,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 0), "utf8");

  console.log("Stocks (CS + ADRC):", stocks.length);
  console.log("Saved to:", OUTPUT_PATH);
}

buildStocksDb().catch((err) => {
  console.error(err);
  process.exit(1);
});
