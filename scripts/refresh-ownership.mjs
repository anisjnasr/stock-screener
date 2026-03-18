#!/usr/bin/env node
/**
 * Quarterly refresh: ownership data from SEC 13F (fund count, top 5 holders per stock).
 * Downloads the last 8 quarters by default, parses, maps CUSIP→symbol, aggregates, upserts ownership table.
 * Run: node scripts/refresh-ownership.mjs [--limit N]  or  npm run refresh-ownership
 * --limit N: only process symbols that appear in the first N companies (for testing).
 * Requires: data/screener.db (companies table). Creates data/13f/, data/cusip-to-symbol.json.
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseQuarter13F } from "./sec-13f-parse.mjs";
import { ensureQuartersDownloaded, QUARTERS_12 } from "./sec-13f-download.mjs";
import { resolveCusipMap } from "./sec-13f-cusip-map.mjs";
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
const RECOMPUTE = process.argv.includes("--recompute");
const quartersIdx = process.argv.indexOf("--quarters");
const QUARTERS_ARG = quartersIdx >= 0 && process.argv[quartersIdx + 1] ? parseInt(process.argv[quartersIdx + 1], 10) : null;

function* allParsedHoldings(quarterPaths) {
  for (const { quarter, path } of quarterPaths) {
    for (const row of parseQuarter13F(path, quarter.reportDate, { latestByFilerQuarter: true })) {
      yield row;
    }
  }
}

/**
 * Yield all holdings from all quarter ZIPs with symbol resolved.
 * Only yields rows where CUSIP maps to a symbol.
 */
function* allHoldingsWithSymbol(quarterPaths, cusipToSymbol) {
  for (const row of allParsedHoldings(quarterPaths)) {
    const symbol = cusipToSymbol[row.cusip];
    if (!symbol) continue;
    yield { ...row, symbol };
  }
}

function collectUniqueCusipIssuerPairs(quarterPaths) {
  const byCusip = new Map();
  for (const row of allParsedHoldings(quarterPaths)) {
    if (!row?.cusip) continue;
    if (!byCusip.has(row.cusip)) {
      byCusip.set(row.cusip, { cusip: row.cusip, issuerName: row.issuerName || "" });
    }
  }
  return [...byCusip.values()];
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  console.log("1. Ensuring 13F data...");
  const nQuarters = LATEST_ONLY ? 1 : QUARTERS_ARG && Number.isFinite(QUARTERS_ARG) ? Math.max(1, QUARTERS_ARG) : 8;
  const quarterList = LATEST_ONLY ? QUARTERS_12.slice(0, 1) : QUARTERS_12.slice(0, nQuarters);
  const quarterPaths = NO_DOWNLOAD
    ? quarterList.map((q) => ({ quarter: q, path: join(DATA_DIR, "13f", `${q.key}.zip`) })).filter(
        (p) => existsSync(p.path)
      )
    : await ensureQuartersDownloaded(nQuarters);
  if (quarterPaths.length === 0) {
    console.error("No 13F ZIPs found. Run without --no-download to download, or add data/13f/*.zip");
    process.exit(1);
  }
  console.log("   Using", quarterPaths.length, "quarter(s)");

  console.log("2. Building CUSIP candidate set...");
  const uniqueCusipIssuerPairs = collectUniqueCusipIssuerPairs(quarterPaths);
  console.log("   Unique CUSIPs in selected filings:", uniqueCusipIssuerPairs.length);

  console.log("3. Resolving CUSIP → symbol (OpenFIGI primary + fallback)...");
  const openfigiKey = String(process.env.OPENFIGI_API_KEY || "").trim();
  const useOpenfigi = openfigiKey.length > 0;
  if (!useOpenfigi) {
    console.log("   OPENFIGI_API_KEY not set; proceeding with SEC/heuristic fallback mapping only for this run.");
  }
  const { map: cusipToSymbol, stats: mapStats } = await resolveCusipMap(uniqueCusipIssuerPairs, {
    useOpenfigi,
    apiKey: openfigiKey,
    userAgent: process.env.OPENFIGI_USER_AGENT || "stock-scanner admin@localhost",
  });
  console.log(
    "   Mapping stats:",
    JSON.stringify(mapStats)
  );

  console.log("4. Parsing and aggregating holdings...");
  const holdingsIter = allHoldingsWithSymbol(quarterPaths, cusipToSymbol);
  const byReportDate = aggregateHoldings(holdingsIter);
  const reportDatesOrdered = [...byReportDate.keys()].sort();
  const rows = addNumFundsChange(byReportDate, reportDatesOrdered);

  const mappedCusips = new Set(Object.keys(cusipToSymbol));
  let mappedRows = 0;
  let totalRows = 0;
  const byQuarterRowCounts = new Map();
  const unmappedCusipCounts = new Map();
  for (const row of allParsedHoldings(quarterPaths)) {
    totalRows++;
    if (mappedCusips.has(row.cusip)) {
      mappedRows++;
      byQuarterRowCounts.set(row.reportDate, (byQuarterRowCounts.get(row.reportDate) || 0) + 1);
    } else {
      unmappedCusipCounts.set(row.cusip, (unmappedCusipCounts.get(row.cusip) || 0) + 1);
    }
  }
  const coverage = totalRows > 0 ? (mappedRows / totalRows) * 100 : 0;
  console.log(`   Coverage (mapped holdings rows): ${mappedRows}/${totalRows} (${coverage.toFixed(2)}%)`);
  console.log("   Per-quarter mapped row counts:", JSON.stringify(Object.fromEntries([...byQuarterRowCounts.entries()].sort())));
  const topUnmapped = [...unmappedCusipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (topUnmapped.length > 0) {
    console.log("   Top unmapped CUSIPs (count):", topUnmapped.map(([c, n]) => `${c}:${n}`).join(", "));
  }

  // Basic monotonic quarter-order sanity check.
  const reportDatesSorted = [...reportDatesOrdered].sort();
  const monotonicOk = reportDatesOrdered.every((d, i) => d === reportDatesSorted[i]);
  if (!monotonicOk) {
    console.warn("   Warning: report_dates are not sorted monotonically:", reportDatesOrdered.join(", "));
  }

  let symbolsToSave = null;
  if (SYMBOLS_ARG) {
    symbolsToSave = new Set(SYMBOLS_ARG.split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean));
    console.log("   Limiting to symbols:", [...symbolsToSave].join(", "));
  } else if (LIMIT != null && LIMIT > 0) {
    const db = new Database(DB_PATH, { readonly: true });
    const r = db.prepare("SELECT symbol FROM companies ORDER BY symbol LIMIT ?").all(LIMIT);
    db.close();
    symbolsToSave = new Set(r.map((v) => v.symbol));
    console.log("   Limiting to", LIMIT, "symbols");
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  db.pragma("busy_timeout = 10000");

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO ownership (symbol, report_date, num_funds, num_funds_change, top_holders, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const prevNumFundsStmt = db.prepare(
    "SELECT num_funds FROM ownership WHERE symbol = ? AND report_date < ? ORDER BY report_date DESC LIMIT 1"
  );

  if (RECOMPUTE && reportDatesOrdered.length > 0) {
    const placeholders = reportDatesOrdered.map(() => "?").join(",");
    db.prepare(`DELETE FROM ownership WHERE report_date IN (${placeholders})`).run(...reportDatesOrdered);
    console.log("   Recompute mode: cleared existing ownership rows for report dates:", reportDatesOrdered.join(", "));
  }

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (symbolsToSave != null && !symbolsToSave.has(row.symbol)) continue;
      const topHoldersJson = JSON.stringify(row.top_holders || []);
      let change = row.num_funds_change;
      if ((change == null || !Number.isFinite(change)) && row.num_funds != null) {
        const prev = prevNumFundsStmt.get(row.symbol, row.report_date);
        const prevNum = prev?.num_funds != null ? Number(prev.num_funds) : null;
        if (prevNum != null && Number.isFinite(prevNum)) {
          change = Number(row.num_funds) - prevNum;
        }
      }
      upsert.run(
        row.symbol,
        row.report_date,
        row.num_funds,
        change,
        topHoldersJson,
        now
      );
      inserted++;
    }
  });
  tx();
  db.pragma("optimize");
  db.close();
  console.log("5. Wrote", inserted, "ownership rows. Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
