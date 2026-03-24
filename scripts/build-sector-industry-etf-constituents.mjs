#!/usr/bin/env node
/**
 * Build sector and industry ETF constituent lists from public ETF holdings pages.
 * Writes:
 *   data/sector-etf-constituents.json   — { "XLK": ["AAPL", ...], ... }
 *   data/industry-etf-constituents.json  — { "ITA": ["LMT", ...], ... }
 *
 * Same approach as build-thematic-etf-constituents.mjs: scrapes the top holdings
 * table from stockanalysis.com for each ETF.
 *
 * Run: node scripts/build-sector-industry-etf-constituents.mjs
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");

const SECTOR_ETFS = [
  "XLK", "XLF", "XLV", "XLY", "XLP", "XLC", "XLI", "XLE", "XLB", "XLRE", "XLU",
];

const INDUSTRY_ETFS = [
  "ITA", "JETS", "CARZ", "KBE", "KRE", "PBJ", "XBI", "KCE", "XPH", "BETZ",
  "GDX", "IHF", "ITB", "KIE", "IHI", "XME", "XOP", "VNQ", "SMH", "IGV",
  "XRT", "IYZ", "IYT",
];

const PACE_MS = 200;

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

async function fetchAll(tickers) {
  const out = {};
  for (const ticker of tickers) {
    try {
      const symbols = await fetchConstituentsForEtf(ticker);
      out[ticker] = symbols.length > 0 ? symbols : [ticker];
      console.log(`${ticker}: ${symbols.length} symbols${symbols.length === 0 ? " (fallback to ETF ticker)" : ""}`);
    } catch (error) {
      out[ticker] = [ticker];
      console.warn(`${ticker}: failed (${error instanceof Error ? error.message : String(error)}), fallback to ETF ticker`);
    }
    await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  }
  return out;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log("Fetching sector ETF constituents...");
  const sectors = await fetchAll(SECTOR_ETFS);
  const sectorPath = join(DATA_DIR, "sector-etf-constituents.json");
  writeFileSync(sectorPath, JSON.stringify(sectors), "utf8");
  console.log(`Wrote ${sectorPath}\n`);

  console.log("Fetching industry ETF constituents...");
  const industries = await fetchAll(INDUSTRY_ETFS);
  const industryPath = join(DATA_DIR, "industry-etf-constituents.json");
  writeFileSync(industryPath, JSON.stringify(industries), "utf8");
  console.log(`Wrote ${industryPath}\n`);

  const totalSymbols = new Set([
    ...Object.values(sectors).flat(),
    ...Object.values(industries).flat(),
  ]).size;
  console.log(`Done. ${SECTOR_ETFS.length} sector ETFs, ${INDUSTRY_ETFS.length} industry ETFs, ${totalSymbols} unique constituent symbols.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
