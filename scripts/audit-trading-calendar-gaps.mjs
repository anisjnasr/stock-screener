#!/usr/bin/env node
/**
 * Strict trading-calendar gap audit for daily_bars.
 *
 * Universe:
 *   - Active companies universe (companies table)
 *   - Required ETF/benchmark symbols used by refresh/backfill workflows
 *
 * Calendar:
 *   - Uses SPY dates by default as the expected U.S. trading-day calendar
 *   - Fallbacks: QQQ, IWM, DIA
 *
 * Output:
 *   - Human-readable summary in stdout
 *   - JSON report for automation/backfill wiring
 *
 * Run:
 *   node scripts/audit-trading-calendar-gaps.mjs
 *   node scripts/audit-trading-calendar-gaps.mjs --out data/trading-gap-audit.json
 *   node scripts/audit-trading-calendar-gaps.mjs --calendar-symbol QQQ
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

const REQUIRED_ETF_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA",
  "XLK", "XLF", "XLV", "XLY", "XLP", "XLC", "XLI", "XLE", "XLB", "XLRE", "XLU",
  "ITA", "JETS", "CARZ", "KBE", "KRE", "PBJ", "XBI", "KCE", "XPH", "BETZ",
  "GDX", "IHF", "ITB", "KIE", "IHI", "XME", "XOP", "VNQ", "SMH", "IGV",
  "XRT", "IYZ", "IYT",
  "BOTZ", "SKYY", "CIBR", "DTCR", "SNSR", "QTUM", "ARKX", "ARKK",
  "ICLN", "TAN", "URA", "HYDR", "PHO", "LIT", "PAVE", "GRID",
  "SIL", "COPX", "REMX", "MOO", "IBIT", "BLOK", "FINX", "OZEM",
  "MSOS", "ESPO", "SOCL", "IBUY", "KWEB", "INDA",
];

function getArgValue(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnvLocal();

const OUTPUT_PATH = getArgValue("--out", join("data", "trading-gap-audit.json"));
const REQUESTED_CALENDAR_SYMBOL = String(getArgValue("--calendar-symbol", "SPY")).toUpperCase();
const CALENDAR_FALLBACKS = ["SPY", "QQQ", "IWM", "DIA"];

function toRanges(missingDates) {
  if (missingDates.length === 0) return [];
  const ranges = [];
  let start = missingDates[0];
  let prev = missingDates[0];
  let count = 1;
  for (let i = 1; i < missingDates.length; i++) {
    const cur = missingDates[i];
    const prevDt = new Date(`${prev}T00:00:00Z`);
    const curDt = new Date(`${cur}T00:00:00Z`);
    const diffDays = Math.round((curDt.getTime() - prevDt.getTime()) / 86400000);
    if (diffDays <= 3) {
      prev = cur;
      count += 1;
      continue;
    }
    ranges.push({ from: start, to: prev, tradingDays: count });
    start = cur;
    prev = cur;
    count = 1;
  }
  ranges.push({ from: start, to: prev, tradingDays: count });
  return ranges;
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  db.pragma("query_only = ON");

  const companies = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all().map((r) => String(r.symbol).toUpperCase());
  const universe = Array.from(new Set([...companies, ...REQUIRED_ETF_SYMBOLS])).sort();
  const universeSet = new Set(universe);

  const symbolsToTry = [REQUESTED_CALENDAR_SYMBOL, ...CALENDAR_FALLBACKS.filter((s) => s !== REQUESTED_CALENDAR_SYMBOL)];
  let calendarSymbol = null;
  let calendarDates = [];
  for (const sym of symbolsToTry) {
    const rows = db.prepare("SELECT date FROM daily_bars WHERE symbol = ? ORDER BY date").all(sym);
    if (rows.length > 0) {
      calendarSymbol = sym;
      calendarDates = rows.map((r) => r.date);
      break;
    }
  }
  if (!calendarSymbol || calendarDates.length === 0) {
    console.error("Unable to resolve a trading calendar symbol with bars (tried SPY/QQQ/IWM/DIA).");
    process.exit(1);
  }

  const calendarIndex = new Map(calendarDates.map((d, i) => [d, i]));
  const calendarFirst = calendarDates[0];
  const calendarLast = calendarDates[calendarDates.length - 1];

  const getSymbolDates = db.prepare("SELECT date FROM daily_bars WHERE symbol = ? ORDER BY date");
  const inCompanies = new Set(companies);

  const symbolReports = [];
  let symbolsWithMissing = 0;
  let totalMissingDays = 0;
  let symbolsWithoutBars = 0;

  for (const symbol of universe) {
    const rows = getSymbolDates.all(symbol);
    const hasBars = rows.length > 0;
    if (!hasBars) {
      symbolsWithoutBars += 1;
      symbolReports.push({
        symbol,
        isInCompanies: inCompanies.has(symbol),
        isRequiredEtf: REQUIRED_ETF_SYMBOLS.includes(symbol),
        hasBars: false,
        firstDate: null,
        lastDate: null,
        missingDays: calendarDates.length,
        missingRanges: [{ from: calendarFirst, to: calendarLast, tradingDays: calendarDates.length }],
      });
      symbolsWithMissing += 1;
      totalMissingDays += calendarDates.length;
      continue;
    }

    const dates = rows.map((r) => r.date);
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];

    const firstIdx = calendarIndex.get(firstDate);
    const lastIdx = calendarIndex.get(lastDate);

    if (firstIdx == null || lastIdx == null || firstIdx > lastIdx) {
      symbolReports.push({
        symbol,
        isInCompanies: inCompanies.has(symbol),
        isRequiredEtf: REQUIRED_ETF_SYMBOLS.includes(symbol),
        hasBars: true,
        firstDate,
        lastDate,
        missingDays: 0,
        missingRanges: [],
      });
      continue;
    }

    const present = new Set(dates);
    const missing = [];
    for (let i = firstIdx; i <= lastIdx; i++) {
      const d = calendarDates[i];
      if (!present.has(d)) missing.push(d);
    }
    const ranges = toRanges(missing);

    if (missing.length > 0) {
      symbolsWithMissing += 1;
      totalMissingDays += missing.length;
    }
    symbolReports.push({
      symbol,
      isInCompanies: inCompanies.has(symbol),
      isRequiredEtf: REQUIRED_ETF_SYMBOLS.includes(symbol),
      hasBars: true,
      firstDate,
      lastDate,
      missingDays: missing.length,
      missingRanges: ranges,
    });
  }

  symbolReports.sort((a, b) => b.missingDays - a.missingDays || a.symbol.localeCompare(b.symbol));
  const topMissing = symbolReports.filter((s) => s.missingDays > 0).slice(0, 25);

  const output = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    calendarSymbol,
    calendarFirst,
    calendarLast,
    calendarTradingDays: calendarDates.length,
    universe: {
      mode: "companies_plus_required_etfs",
      companiesCount: companies.length,
      requiredEtfCount: REQUIRED_ETF_SYMBOLS.length,
      totalSymbols: universe.length,
    },
    summary: {
      symbolsWithMissing,
      symbolsWithoutBars,
      totalMissingDays,
    },
    topMissing,
    symbols: symbolReports,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log(`Calendar symbol: ${calendarSymbol} (${calendarFirst} -> ${calendarLast}, ${calendarDates.length} trading days)`);
  console.log(`Universe symbols: ${universe.length} (companies: ${companies.length}, required ETFs: ${REQUIRED_ETF_SYMBOLS.length})`);
  console.log(`Symbols with missing days: ${symbolsWithMissing}`);
  console.log(`Symbols without bars: ${symbolsWithoutBars}`);
  console.log(`Total missing trading days: ${totalMissingDays}`);
  console.log(`Wrote audit report: ${OUTPUT_PATH}`);

  db.close();
}

main();

