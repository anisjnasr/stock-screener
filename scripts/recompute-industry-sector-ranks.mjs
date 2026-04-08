#!/usr/bin/env node
/**
 * Recompute industry/sector ranks across all indicators_daily dates.
 * Uses current companies.classification (sector/industry), so run after reclassification.
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dbPath as DB_PATH } from "./_db-paths.mjs";

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");
db.pragma("busy_timeout = 10000");

const rs = (stockRet, spyRet) =>
  stockRet != null && spyRet != null ? ((1 + stockRet / 100) / (1 + spyRet / 100)) * 100 : null;

function toNumOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

try {
  const dates = db
    .prepare("SELECT DISTINCT date FROM indicators_daily ORDER BY date")
    .all()
    .map((r) => String(r.date));
  if (dates.length === 0) {
    console.log("No indicators_daily rows found. Nothing to recompute.");
    process.exit(0);
  }

  const spyBars = db
    .prepare("SELECT date, close FROM daily_bars WHERE symbol = 'SPY' ORDER BY date")
    .all()
    .map((r) => ({ date: String(r.date), close: toNumOrNull(r.close) }));
  const spyIdxByDate = new Map(spyBars.map((r, i) => [r.date, i]));

  const getRowsForDate = db.prepare(`
    SELECT
      i.symbol,
      c.industry,
      c.sector,
      i.rs_vs_spy_1m, i.rs_vs_spy_3m, i.rs_vs_spy_6m, i.rs_vs_spy_12m,
      i.price_change_1m_pct, i.price_change_3m_pct, i.price_change_6m_pct, i.price_change_12m_pct,
      q.market_cap,
      c.shares_outstanding,
      b.close
    FROM indicators_daily i
    LEFT JOIN companies c ON c.symbol = i.symbol
    LEFT JOIN quote_daily q ON q.symbol = i.symbol AND q.date = i.date
    LEFT JOIN daily_bars b ON b.symbol = i.symbol AND b.date = i.date
    WHERE i.date = ?
  `);

  const updateStmt = db.prepare(`
    UPDATE indicators_daily
    SET
      industry_rank_1m = ?,
      industry_rank_3m = ?,
      industry_rank_6m = ?,
      industry_rank_12m = ?,
      sector_rank_1m = ?,
      sector_rank_3m = ?,
      sector_rank_6m = ?,
      sector_rank_12m = ?
    WHERE symbol = ? AND date = ?
  `);

  const updateTx = db.transaction((items, date) => {
    for (const r of items) {
      updateStmt.run(
        r.industry_rank_1m ?? null,
        r.industry_rank_3m ?? null,
        r.industry_rank_6m ?? null,
        r.industry_rank_12m ?? null,
        r.sector_rank_1m ?? null,
        r.sector_rank_3m ?? null,
        r.sector_rank_6m ?? null,
        r.sector_rank_12m ?? null,
        r.symbol,
        date
      );
    }
  });

  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const rows = getRowsForDate.all(date).map((r) => {
      const cap = toNumOrNull(r.market_cap);
      const shares = toNumOrNull(r.shares_outstanding);
      const close = toNumOrNull(r.close);
      return {
        symbol: String(r.symbol),
        industry: typeof r.industry === "string" && r.industry.trim() ? r.industry.trim() : null,
        sector: typeof r.sector === "string" && r.sector.trim() ? r.sector.trim() : null,
        rs1m: toNumOrNull(r.rs_vs_spy_1m),
        rs3m: toNumOrNull(r.rs_vs_spy_3m),
        rs6m: toNumOrNull(r.rs_vs_spy_6m),
        rs12m: toNumOrNull(r.rs_vs_spy_12m),
        ret1m: toNumOrNull(r.price_change_1m_pct),
        ret3m: toNumOrNull(r.price_change_3m_pct),
        ret6m: toNumOrNull(r.price_change_6m_pct),
        ret12m: toNumOrNull(r.price_change_12m_pct),
        marketCapWeight:
          cap != null && cap > 0
            ? cap
            : shares != null && shares > 0 && close != null && close > 0
              ? shares * close
              : null,
        industry_rank_1m: null,
        industry_rank_3m: null,
        industry_rank_6m: null,
        industry_rank_12m: null,
        sector_rank_1m: null,
        sector_rank_3m: null,
        sector_rank_6m: null,
        sector_rank_12m: null,
      };
    });

    const spyIdx = spyIdxByDate.get(date);
    const spyClose = spyIdx != null ? spyBars[spyIdx]?.close ?? null : null;
    const spyClose21 = spyIdx != null && spyIdx >= 21 ? spyBars[spyIdx - 21]?.close ?? null : null;
    const spyClose63 = spyIdx != null && spyIdx >= 63 ? spyBars[spyIdx - 63]?.close ?? null : null;
    const spyClose126 = spyIdx != null && spyIdx >= 126 ? spyBars[spyIdx - 126]?.close ?? null : null;
    const spyClose252 = spyIdx != null && spyIdx >= 252 ? spyBars[spyIdx - 252]?.close ?? null : null;
    const spyRet1m = spyClose != null && spyClose21 ? ((spyClose - spyClose21) / spyClose21) * 100 : null;
    const spyRet3m = spyClose != null && spyClose63 ? ((spyClose - spyClose63) / spyClose63) * 100 : null;
    const spyRet6m = spyClose != null && spyClose126 ? ((spyClose - spyClose126) / spyClose126) * 100 : null;
    const spyRet12m = spyClose != null && spyClose252 ? ((spyClose - spyClose252) / spyClose252) * 100 : null;

    const industryAgg = new Map();
    const bySector = new Map();
    for (const r of rows) {
      if (r.sector) {
        if (!bySector.has(r.sector)) bySector.set(r.sector, []);
        bySector.get(r.sector).push(r);
      }
      if (!r.industry) continue;
      const w = r.marketCapWeight;
      if (w == null || !Number.isFinite(w) || w <= 0) continue;
      if (!industryAgg.has(r.industry)) {
        industryAgg.set(r.industry, { w1m: 0, wr1m: 0, w3m: 0, wr3m: 0, w6m: 0, wr6m: 0, w12m: 0, wr12m: 0 });
      }
      const agg = industryAgg.get(r.industry);
      if (r.ret1m != null) { agg.w1m += w; agg.wr1m += w * r.ret1m; }
      if (r.ret3m != null) { agg.w3m += w; agg.wr3m += w * r.ret3m; }
      if (r.ret6m != null) { agg.w6m += w; agg.wr6m += w * r.ret6m; }
      if (r.ret12m != null) { agg.w12m += w; agg.wr12m += w * r.ret12m; }
    }

    const industryRows = [];
    for (const [industry, agg] of industryAgg.entries()) {
      const indRet1m = agg.w1m > 0 ? agg.wr1m / agg.w1m : null;
      const indRet3m = agg.w3m > 0 ? agg.wr3m / agg.w3m : null;
      const indRet6m = agg.w6m > 0 ? agg.wr6m / agg.w6m : null;
      const indRet12m = agg.w12m > 0 ? agg.wr12m / agg.w12m : null;
      industryRows.push({
        industry,
        rs1m: rs(indRet1m, spyRet1m),
        rs3m: rs(indRet3m, spyRet3m),
        rs6m: rs(indRet6m, spyRet6m),
        rs12m: rs(indRet12m, spyRet12m),
      });
    }

    const applyIndustryRanks = (rsKey, rankKey) => {
      const sorted = [...industryRows].sort((a, b) => {
        const av = a[rsKey];
        const bv = b[rsKey];
        if (av == null && bv == null) return a.industry.localeCompare(b.industry);
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
      const rankByIndustry = new Map();
      sorted.forEach((row, idx) => rankByIndustry.set(row.industry, idx + 1));
      for (const r of rows) {
        r[rankKey] = r.industry ? rankByIndustry.get(r.industry) ?? null : null;
      }
    };

    applyIndustryRanks("rs1m", "industry_rank_1m");
    applyIndustryRanks("rs3m", "industry_rank_3m");
    applyIndustryRanks("rs6m", "industry_rank_6m");
    applyIndustryRanks("rs12m", "industry_rank_12m");

    for (const [, list] of bySector) {
      list.sort((a, b) => (b.rs1m ?? -1e9) - (a.rs1m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_1m = i + 1; });
      list.sort((a, b) => (b.rs3m ?? -1e9) - (a.rs3m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_3m = i + 1; });
      list.sort((a, b) => (b.rs6m ?? -1e9) - (a.rs6m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_6m = i + 1; });
      list.sort((a, b) => (b.rs12m ?? -1e9) - (a.rs12m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_12m = i + 1; });
    }

    updateTx(rows, date);
    if ((di + 1) % 100 === 0 || di === dates.length - 1) {
      process.stdout.write(`  dates: ${di + 1}/${dates.length}\r`);
    }
  }

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  console.log("\nRecomputed industry/sector ranks for all dates.");
} finally {
  db.close();
}

