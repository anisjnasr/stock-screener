#!/usr/bin/env node
/**
 * Verify industry rank integrity on the latest indicators date.
 * - Checks rank consistency per industry across symbols
 * - Recomputes weighted industry RS vs SPY and compares to stored ranks
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dbPath as DB_PATH } from "./_db-paths.mjs";

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

const rs = (stockRet, spyRet) =>
  stockRet != null && spyRet != null ? ((1 + stockRet / 100) / (1 + spyRet / 100)) * 100 : null;

const toNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

try {
  const latestDate = String(
    db.prepare("SELECT MAX(date) AS d FROM indicators_daily").get()?.d ?? ""
  );
  if (!latestDate) {
    console.log(JSON.stringify({ ok: false, error: "No indicators_daily rows." }, null, 2));
    process.exit(1);
  }

  const rows = db
    .prepare(
      `
      SELECT
        i.symbol,
        c.industry,
        i.industry_rank_1m, i.industry_rank_3m, i.industry_rank_6m, i.industry_rank_12m,
        i.price_change_1m_pct, i.price_change_3m_pct, i.price_change_6m_pct, i.price_change_12m_pct,
        q.market_cap, c.shares_outstanding, b.close
      FROM indicators_daily i
      JOIN companies c ON c.symbol = i.symbol
      LEFT JOIN quote_daily q ON q.symbol = i.symbol AND q.date = i.date
      LEFT JOIN daily_bars b ON b.symbol = i.symbol AND b.date = i.date
      WHERE i.date = ?
      `
    )
    .all(latestDate);

  const spySeries = db
    .prepare("SELECT date, close FROM daily_bars WHERE symbol = 'SPY' ORDER BY date")
    .all()
    .map((r) => ({ date: String(r.date), close: toNum(r.close) }));
  const spyIdxByDate = new Map(spySeries.map((r, idx) => [r.date, idx]));
  const spyIdx = spyIdxByDate.get(latestDate);
  const spyClose = spyIdx != null ? spySeries[spyIdx]?.close ?? null : null;
  const spyClose21 = spyIdx != null && spyIdx >= 21 ? spySeries[spyIdx - 21]?.close ?? null : null;
  const spyClose63 = spyIdx != null && spyIdx >= 63 ? spySeries[spyIdx - 63]?.close ?? null : null;
  const spyClose126 = spyIdx != null && spyIdx >= 126 ? spySeries[spyIdx - 126]?.close ?? null : null;
  const spyClose252 = spyIdx != null && spyIdx >= 252 ? spySeries[spyIdx - 252]?.close ?? null : null;
  const spyRet1m = spyClose != null && spyClose21 ? ((spyClose - spyClose21) / spyClose21) * 100 : null;
  const spyRet3m = spyClose != null && spyClose63 ? ((spyClose - spyClose63) / spyClose63) * 100 : null;
  const spyRet6m = spyClose != null && spyClose126 ? ((spyClose - spyClose126) / spyClose126) * 100 : null;
  const spyRet12m = spyClose != null && spyClose252 ? ((spyClose - spyClose252) / spyClose252) * 100 : null;

  const byIndustry = new Map();
  const rankSetByIndustry = new Map();
  for (const row of rows) {
    const industry = typeof row.industry === "string" ? row.industry.trim() : "";
    if (!industry) continue;
    const cap = toNum(row.market_cap);
    const shares = toNum(row.shares_outstanding);
    const close = toNum(row.close);
    const weight =
      cap != null && cap > 0
        ? cap
        : shares != null && shares > 0 && close != null && close > 0
          ? shares * close
          : null;

    if (!rankSetByIndustry.has(industry)) {
      rankSetByIndustry.set(industry, {
        storedRanks1m: new Set(),
        storedRanks3m: new Set(),
        storedRanks6m: new Set(),
        storedRanks12m: new Set(),
      });
    }
    const rankSets = rankSetByIndustry.get(industry);
    rankSets.storedRanks1m.add(row.industry_rank_1m);
    rankSets.storedRanks3m.add(row.industry_rank_3m);
    rankSets.storedRanks6m.add(row.industry_rank_6m);
    rankSets.storedRanks12m.add(row.industry_rank_12m);
    if (weight == null || weight <= 0) continue;
    if (!byIndustry.has(industry)) {
      byIndustry.set(industry, {
        w1m: 0,
        wr1m: 0,
        w3m: 0,
        wr3m: 0,
        w6m: 0,
        wr6m: 0,
        w12m: 0,
        wr12m: 0,
      });
    }
    const agg = byIndustry.get(industry);
    const r1m = toNum(row.price_change_1m_pct);
    const r3m = toNum(row.price_change_3m_pct);
    const r6m = toNum(row.price_change_6m_pct);
    const r12m = toNum(row.price_change_12m_pct);
    if (r1m != null) {
      agg.w1m += weight;
      agg.wr1m += weight * r1m;
    }
    if (r3m != null) {
      agg.w3m += weight;
      agg.wr3m += weight * r3m;
    }
    if (r6m != null) {
      agg.w6m += weight;
      agg.wr6m += weight * r6m;
    }
    if (r12m != null) {
      agg.w12m += weight;
      agg.wr12m += weight * r12m;
    }
  }

  const industryRows = [];
  for (const [industry, a] of byIndustry.entries()) {
    const indRet1m = a.w1m > 0 ? a.wr1m / a.w1m : null;
    const indRet3m = a.w3m > 0 ? a.wr3m / a.w3m : null;
    const indRet6m = a.w6m > 0 ? a.wr6m / a.w6m : null;
    const indRet12m = a.w12m > 0 ? a.wr12m / a.w12m : null;
    industryRows.push({
      industry,
      rs1m: rs(indRet1m, spyRet1m),
      rs3m: rs(indRet3m, spyRet3m),
      rs6m: rs(indRet6m, spyRet6m),
      rs12m: rs(indRet12m, spyRet12m),
    });
  }

  const expectedRankMap = (key) => {
    const sorted = [...industryRows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return a.industry.localeCompare(b.industry);
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
    return new Map(sorted.map((r, idx) => [r.industry, idx + 1]));
  };

  const exp1m = expectedRankMap("rs1m");
  const exp3m = expectedRankMap("rs3m");
  const exp6m = expectedRankMap("rs6m");
  const exp12m = expectedRankMap("rs12m");

  let inconsistentIndustryRows = 0;
  let mismatch1m = 0;
  let mismatch3m = 0;
  let mismatch6m = 0;
  let mismatch12m = 0;

  for (const [industry, a] of byIndustry.entries()) {
    const rankSets = rankSetByIndustry.get(industry);
    if (
      rankSets.storedRanks1m.size > 1 ||
      rankSets.storedRanks3m.size > 1 ||
      rankSets.storedRanks6m.size > 1 ||
      rankSets.storedRanks12m.size > 1
    ) {
      inconsistentIndustryRows += 1;
    }
    const stored1m = rankSets.storedRanks1m.values().next().value ?? null;
    const stored3m = rankSets.storedRanks3m.values().next().value ?? null;
    const stored6m = rankSets.storedRanks6m.values().next().value ?? null;
    const stored12m = rankSets.storedRanks12m.values().next().value ?? null;
    if ((exp1m.get(industry) ?? null) !== (stored1m ?? null)) mismatch1m += 1;
    if ((exp3m.get(industry) ?? null) !== (stored3m ?? null)) mismatch3m += 1;
    if ((exp6m.get(industry) ?? null) !== (stored6m ?? null)) mismatch6m += 1;
    if ((exp12m.get(industry) ?? null) !== (stored12m ?? null)) mismatch12m += 1;
  }

  const nonEtfIndustryUniverse = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM (SELECT DISTINCT TRIM(industry) AS i FROM companies WHERE COALESCE(is_etf,0)=0 AND industry IS NOT NULL AND TRIM(industry) <> '')"
      )
      .get()?.c ?? 0
  );

  const result = {
    ok:
      inconsistentIndustryRows === 0 &&
      mismatch1m === 0 &&
      mismatch3m === 0 &&
      mismatch6m === 0 &&
      mismatch12m === 0,
    latestDate,
    industriesInLatestIndicators: byIndustry.size,
    nonEtfIndustryUniverse,
    inconsistentIndustryRows,
    mismatches: {
      rank1m: mismatch1m,
      rank3m: mismatch3m,
      rank6m: mismatch6m,
      rank12m: mismatch12m,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} finally {
  db.close();
}

