#!/usr/bin/env node
/**
 * Quarterly refresh: ownership data from SEC 13F (fund count, top 5 holders per stock).
 * Downloads last 12 quarters of 13F ZIPs, parses, maps CUSIP→symbol, aggregates, upserts ownership table.
 * Run: node scripts/refresh-ownership.mjs [--limit N]  or  npm run refresh-ownership
 * --limit N: only process symbols that appear in the first N companies (for testing).
 * Requires: data/screener.db (companies table). Creates data/13f/, data/cusip-to-symbol.json.
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseQuarter13F } from "./sec-13f-parse.mjs";
import { ensureQuartersDownloaded, QUARTERS_12 } from "./sec-13f-download.mjs";
import { loadCusipToSymbolMap, buildCusipToSymbolMap } from "./sec-13f-cusip-map.mjs";
import { aggregateHoldings, addNumFundsChange } from "./sec-13f-aggregate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");

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

const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;
const symbolsIdx = process.argv.indexOf("--symbols");
const SYMBOLS_ARG = symbolsIdx >= 0 && process.argv[symbolsIdx + 1] ? process.argv[symbolsIdx + 1] : null;
const NO_DOWNLOAD = process.argv.includes("--no-download");
const LATEST_ONLY = process.argv.includes("--latest-only");

/**
 * Yield all holdings from all quarter ZIPs with symbol resolved. Only yields rows where CUSIP maps to a symbol.
 */
function* allHoldingsWithSymbol(quarterPaths, cusipToSymbol) {
  for (const { quarter, path } of quarterPaths) {
    for (const row of parseQuarter13F(path, quarter.reportDate)) {
      const symbol = cusipToSymbol[row.cusip];
      if (symbol) {
        yield {
          ...row,
          symbol,
        };
      }
    }
  }
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  console.log("1. Ensuring 13F data...");
  const nQuarters = LATEST_ONLY ? 1 : 12;
  const quarterPaths = NO_DOWNLOAD
    ? (LATEST_ONLY ? QUARTERS_12.slice(0, 1) : QUARTERS_12).map((q) => ({ quarter: q, path: join(DATA_DIR, "13f", `${q.key}.zip`) })).filter(
        (p) => existsSync(p.path)
      )
    : await ensureQuartersDownloaded(nQuarters);
  if (quarterPaths.length === 0) {
    console.error("No 13F ZIPs found. Run without --no-download to download, or add data/13f/*.zip");
    process.exit(1);
  }
  console.log("   Using", quarterPaths.length, "quarter(s)");

  console.log("2. CUSIP → symbol map...");
  const CUSIP_MAP_PATH = join(DATA_DIR, "cusip-to-symbol.json");
  let cusipToSymbol;
  if (!existsSync(CUSIP_MAP_PATH)) {
    console.log("   Building CUSIP map from issuer names (one-time)...");
    const r = await buildCusipToSymbolMap();
    console.log("   Matched", r.matched, "of", r.total, "unique CUSIP/issuer ->", r.keys, "symbols");
  }
  cusipToSymbol = loadCusipToSymbolMap();

  console.log("3. Parsing and aggregating holdings...");
  const holdingsIter = allHoldingsWithSymbol(quarterPaths, cusipToSymbol);
  const byReportDate = aggregateHoldings(holdingsIter);
  const reportDatesOrdered = [...new Set(quarterPaths.map((p) => p.quarter.reportDate))].sort();
  const rows = addNumFundsChange(byReportDate, reportDatesOrdered);

  let symbolsToSave = null;
  if (SYMBOLS_ARG) {
    symbolsToSave = new Set(SYMBOLS_ARG.split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean));
    console.log("   Limiting to symbols:", [...symbolsToSave].join(", "));
  } else if (LIMIT != null && LIMIT > 0) {
    const SQL = await initSqlJs();
    const buf = readFileSync(DB_PATH);
    const db = new SQL.Database(buf);
    const r = db.exec("SELECT symbol FROM companies ORDER BY symbol LIMIT " + LIMIT);
    db.close();
    symbolsToSave = r.length && r[0].values ? new Set(r[0].values.map((v) => v[0])) : null;
    console.log("   Limiting to", LIMIT, "symbols");
  }

  const SQL = await initSqlJs();
  const buf = readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO ownership (symbol, report_date, num_funds, num_funds_change, top_holders, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const row of rows) {
    if (symbolsToSave != null && !symbolsToSave.has(row.symbol)) continue;
    const topHoldersJson = JSON.stringify(row.top_holders || []);
    upsert.bind([
      row.symbol,
      row.report_date,
      row.num_funds,
      row.num_funds_change,
      topHoldersJson,
      now,
    ]);
    upsert.step();
    upsert.reset();
    inserted++;
  }
  upsert.free();

  writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log("4. Wrote", inserted, "ownership rows. Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
