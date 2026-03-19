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
import { join } from "path";
import { parseQuarter13F } from "./sec-13f-parse.mjs";
import { ensureQuartersDownloaded, QUARTERS_12 } from "./sec-13f-download.mjs";
import { resolveCusipMap } from "./sec-13f-cusip-map.mjs";
import { aggregateHoldings } from "./sec-13f-aggregate.mjs";
import { dataDir as DATA_DIR, dbPath as DB_PATH, root } from "./_db-paths.mjs";

const USING_CUSTOM_DB = Boolean(process.env.SCREENER_DB_PATH);

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
 * Yield holdings for one quarter with symbol resolved.
 * Also updates coverage stats as rows stream through.
 */
function* holdingsWithSymbolForQuarter(quarterPath, cusipToSymbol, coverageStats) {
  const reportDateFallback = quarterPath?.quarter?.reportDate ?? null;
  for (const row of parseQuarter13F(quarterPath.path, reportDateFallback, { latestByFilerQuarter: true })) {
    coverageStats.totalRows++;
    const symbol = cusipToSymbol[row.cusip];
    if (!symbol) continue;
    coverageStats.mappedRows++;
    const reportDate = String(row.reportDate || reportDateFallback || "");
    if (reportDate) {
      coverageStats.byQuarterRowCounts.set(reportDate, (coverageStats.byQuarterRowCounts.get(reportDate) || 0) + 1);
    }
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
    console.error(`Missing screener DB at ${DB_PATH}. Run: npm run init-screener-db && npm run seed-companies`);
    process.exit(1);
  }
  if (USING_CUSTOM_DB) {
    console.log("   Using SCREENER_DB_PATH:", DB_PATH);
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

  console.log("3. Resolving CUSIP → symbol (saved map + overrides + issuer-name fallback)...");
  const { map: cusipToSymbol, stats: mapStats } = await resolveCusipMap(uniqueCusipIssuerPairs);
  console.log(
    "   Mapping stats:",
    JSON.stringify(mapStats)
  );

  const quarterPathsAsc = [...quarterPaths].sort((a, b) => String(a.quarter.reportDate).localeCompare(String(b.quarter.reportDate)));
  const reportDatesFromSelection = [...new Set(quarterPathsAsc.map((q) => String(q.quarter.reportDate)))];

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

  if (RECOMPUTE && reportDatesFromSelection.length > 0) {
    const placeholders = reportDatesFromSelection.map(() => "?").join(",");
    db.prepare(`DELETE FROM ownership WHERE report_date IN (${placeholders})`).run(...reportDatesFromSelection);
    console.log("   Recompute mode: cleared existing ownership rows for report dates:", reportDatesFromSelection.join(", "));
  }

  console.log("4. Parsing, aggregating, and writing quarter-by-quarter...");
  const coverageStats = {
    totalRows: 0,
    mappedRows: 0,
    byQuarterRowCounts: new Map(),
  };

  let inserted = 0;
  for (const quarterPath of quarterPathsAsc) {
    const primaryReportDate = quarterPath.quarter.reportDate;
    console.log(`   Processing ${quarterPath.quarter.key} (${primaryReportDate})...`);
    const byReportDate = aggregateHoldings(holdingsWithSymbolForQuarter(quarterPath, cusipToSymbol, coverageStats));
    const reportDates = [...byReportDate.keys()].sort();

    for (const reportDate of reportDates) {
      if (reportDate !== primaryReportDate) continue;
      const bySymbol = byReportDate.get(reportDate);
      if (!bySymbol) continue;
      const tx = db.transaction(() => {
        for (const [symbol, rec] of bySymbol.entries()) {
          if (symbolsToSave != null && !symbolsToSave.has(symbol)) continue;
          const topHoldersJson = JSON.stringify(rec.top_holders || []);
          let change = null;
          if (rec.num_funds != null) {
            const prev = prevNumFundsStmt.get(symbol, reportDate);
            const prevNum = prev?.num_funds != null ? Number(prev.num_funds) : null;
            if (prevNum != null && Number.isFinite(prevNum)) {
              change = Number(rec.num_funds) - prevNum;
            }
          }
          upsert.run(
            symbol,
            reportDate,
            rec.num_funds,
            change,
            topHoldersJson,
            now
          );
          inserted++;
        }
      });
      tx();
    }
  }

  const coverage = coverageStats.totalRows > 0 ? (coverageStats.mappedRows / coverageStats.totalRows) * 100 : 0;
  console.log(
    `   Coverage (mapped holdings rows): ${coverageStats.mappedRows}/${coverageStats.totalRows} (${coverage.toFixed(2)}%)`
  );
  console.log(
    "   Per-quarter mapped row counts:",
    JSON.stringify(Object.fromEntries([...coverageStats.byQuarterRowCounts.entries()].sort()))
  );

  db.pragma("optimize");
  db.close();
  console.log("5. Wrote", inserted, "ownership rows. Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
