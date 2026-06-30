#!/usr/bin/env node
/**
 * Build thematic ETF constituent lists from public ETF holdings pages.
 * Writes data/thematic-etf-constituents.json as:
 * { "BOTZ": ["NVDA", ...], ... }
 *
 * Notes:
 * - Uses the top holdings table currently available from stockanalysis.com.
 * - Normalizes symbols to upper-case and keeps US-style tickers.
 *
 * Run: node scripts/build-thematic-etf-constituents.mjs
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const OUT_PATH = join(DATA_DIR, "thematic-etf-constituents.json");

const ETF_TICKERS = [
  "BOTZ",
  "SMH",
  "SKYY",
  "CIBR",
  "DTCR",
  "SNSR",
  "QTUM",
  "ARKX",
  "ARKK",
  "XOP",
  "ICLN",
  "TAN",
  "URA",
  "HYDR",
  "PHO",
  "LIT",
  "PAVE",
  "ITA",
  "GRID",
  "GDX",
  "SIL",
  "COPX",
  "REMX",
  "MOO",
  "IBIT",
  "BLOK",
  "FINX",
  "XBI",
  "OZEM",
  "MSOS",
  "BETZ",
  "ESPO",
  "ITB",
  "JETS",
  "SOCL",
  "IBUY",
  "KWEB",
  "INDA",
  "DRNZ",
];

function normalizeSymbol(raw) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z][A-Z0-9.\-]*$/.test(value)) return null;
  return value;
}

function extractSymbolsFromTopHoldingsTable(html) {
  const symbols = [];
  for (const match of html.matchAll(/<tbody[\s\S]*?<\/tbody>/gi)) {
    const tbody = match[0];
    for (const m of tbody.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
      const href = String(m[1] ?? "");
      const label = String(m[2] ?? "").trim();
      if (!href.startsWith("/stocks/")) continue;
      const normalized = normalizeSymbol(label);
      if (normalized) symbols.push(normalized);
    }
  }
  return [...new Set(symbols)];
}

/**
 * When the site layout breaks table parsing, use a minimal known list so drill-down is not empty.
 * Refresh periodically from issuer fact sheets.
 */
const STATIC_HOLDINGS_FALLBACK = {
  MSOS: ["TCNNF", "GTBIF", "CURLF", "CRLBF", "VRNOF", "JUSHF", "TRSSF", "TSNDF"],
  INDA: ["IBN", "HDB", "INFY", "WIT"],
  DRNZ: ["ONDS", "AVAV", "UMAC", "RCAT", "EH", "AVEX", "GE", "PLTR", "RTX", "BA", "LMT", "HON", "HWM", "AIRO", "ZENA", "SWMR"],
};

async function fetchConstituentsForEtf(ticker) {
  const upper = ticker.toUpperCase();
  const url = `https://stockanalysis.com/etf/${ticker.toLowerCase()}/holdings/`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`${ticker}: fetch failed (${response.status})`);
  const html = await response.text();
  let symbols = extractSymbolsFromTopHoldingsTable(html).filter((s) => s !== upper);
  if (symbols.length === 0 && STATIC_HOLDINGS_FALLBACK[upper]) {
    symbols = [...STATIC_HOLDINGS_FALLBACK[upper]];
  }
  return symbols;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const out = {};
  for (const ticker of ETF_TICKERS) {
    try {
      const symbols = await fetchConstituentsForEtf(ticker);
      out[ticker] = symbols.length > 0 ? symbols : [ticker.toUpperCase()];
      console.log(`${ticker}: ${symbols.length} symbols${symbols.length === 0 ? " (fallback to ETF ticker)" : ""}`);
    } catch (error) {
      out[ticker] = [ticker];
      console.warn(`${ticker}: failed (${error instanceof Error ? error.message : String(error)}), fallback to ETF ticker`);
    }
    // Light pacing to reduce chance of temporary blocking.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  writeFileSync(OUT_PATH, JSON.stringify(out), "utf8");
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
