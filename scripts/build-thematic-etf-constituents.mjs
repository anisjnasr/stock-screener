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
];

function normalizeSymbol(raw) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z][A-Z0-9.\-]*$/.test(value)) return null;
  return value;
}

function extractSymbolsFromTopHoldingsTable(html) {
  const tbodyIdx = html.indexOf("<tbody");
  if (tbodyIdx < 0) return [];
  const tbodyEnd = html.indexOf("</tbody>", tbodyIdx);
  if (tbodyEnd < 0) return [];
  const tbody = html.slice(tbodyIdx, tbodyEnd);

  const symbols = [];
  for (const match of tbody.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const href = String(match[1] ?? "");
    const label = String(match[2] ?? "").trim();
    if (!href.startsWith("/stocks/")) continue;
    const normalized = normalizeSymbol(label);
    if (normalized) symbols.push(normalized);
  }
  return [...new Set(symbols)];
}

async function fetchConstituentsForEtf(ticker) {
  const url = `https://stockanalysis.com/etf/${ticker.toLowerCase()}/holdings/`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; stock-tool/1.0)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`${ticker}: fetch failed (${response.status})`);
  const html = await response.text();
  return extractSymbolsFromTopHoldingsTable(html);
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const out = {};
  for (const ticker of ETF_TICKERS) {
    try {
      const symbols = await fetchConstituentsForEtf(ticker);
      out[ticker] = symbols.length > 0 ? symbols : [ticker];
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
