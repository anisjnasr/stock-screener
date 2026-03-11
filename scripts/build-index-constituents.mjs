#!/usr/bin/env node
/**
 * Build index constituent lists (S&P 500, Nasdaq 100, Russell 2000) from public sources.
 * Writes data/sp500.json, data/nasdaq100.json, data/russell2000.json (symbol arrays).
 * Run: node scripts/build-index-constituents.mjs
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === "," && !inQuotes) || (c === "\r" && !inQuotes)) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

async function fetchSp500() {
  const url = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`S&P 500 fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  const symbols = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row[0]) symbols.push(row[0].toUpperCase());
  }
  return symbols;
}

async function fetchNasdaq100() {
  const url = "https://raw.githubusercontent.com/mhyavas/SP500-NASDAQ100/main/nasdaq100.csv";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nasdaq 100 fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  const symbols = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const sym = row[0]?.replace(/^"|"$/g, "").toUpperCase();
    if (sym) {
      if (sym === "FB") symbols.push("META");
      else symbols.push(sym);
    }
  }
  return [...new Set(symbols)];
}

async function fetchRussell2000() {
  const url = "https://raw.githubusercontent.com/ikoniaris/Russell2000/master/russell_2000_components.csv";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Russell 2000 fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  const symbols = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row[0]) symbols.push(row[0].toUpperCase());
  }
  return symbols;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log("Fetching S&P 500...");
  const sp500 = await fetchSp500();
  writeFileSync(join(DATA_DIR, "sp500.json"), JSON.stringify(sp500, null, 0));
  console.log(`  Wrote ${sp500.length} symbols to data/sp500.json`);

  console.log("Fetching Nasdaq 100...");
  const nasdaq100 = await fetchNasdaq100();
  writeFileSync(join(DATA_DIR, "nasdaq100.json"), JSON.stringify(nasdaq100, null, 0));
  console.log(`  Wrote ${nasdaq100.length} symbols to data/nasdaq100.json`);

  console.log("Fetching Russell 2000...");
  const russell2000 = await fetchRussell2000();
  writeFileSync(join(DATA_DIR, "russell2000.json"), JSON.stringify(russell2000, null, 0));
  console.log(`  Wrote ${russell2000.length} symbols to data/russell2000.json`);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
