import "server-only";

import { largeCapPythonRequestDates } from "@/lib/premarket/large-cap-analysis-date";
import { withScreenerDb } from "@/lib/screener-db-native";

export type LargeCapDigestInputs = {
  analysis_date: string;
  db_latest_completed_session: string;
  company: { symbol: string; name: string | null };
  bars: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;
  indicators_prior: Record<string, unknown>;
  indicators_by_date: Record<
    string,
    {
      atr_21: number | null;
      ema_20: number | null;
      ema_50: number | null;
      ema_200: number | null;
    }
  >;
  quote: Record<string, unknown>;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fetchLargeCapDigestInputs(
  ticker: string,
  explicitAnalysisDate?: string | null
): LargeCapDigestInputs {
  return withScreenerDb((db) => {
  const sym = ticker.trim().toUpperCase();
  if (!sym) throw new Error("ticker is required");

  const { analysisDate, dbLatestCompletedDate } = largeCapPythonRequestDates(explicitAnalysisDate);
  const dbLatest = dbLatestCompletedDate ?? analysisDate;

  const companyRow = db
    .prepare("SELECT symbol, name FROM companies WHERE symbol = ?")
    .get(sym) as { symbol: string; name: string | null } | undefined;
  if (!companyRow) throw new Error(`Unknown symbol in screener DB: ${sym}`);

  const bars = db
    .prepare(
      `
      SELECT date, open, high, low, close, volume
      FROM daily_bars
      WHERE symbol = ? AND date < ?
      ORDER BY date ASC
      `
    )
    .all(sym, analysisDate) as Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;

  if (bars.length < 2) {
    throw new Error(`Not enough history for ${sym} before ${analysisDate} (need at least 2 sessions).`);
  }

  const priorDate = String(bars[bars.length - 1]!.date);

  const indKeys = [
    "price_change_1w_pct",
    "price_change_1m_pct",
    "price_change_3m_pct",
    "price_change_6m_pct",
    "price_change_12m_pct",
    "atr_14",
    "atr_pct_14",
    "atr_21",
    "atr_pct_21",
    "ema_20",
    "ema_50",
    "ema_100",
    "ema_200",
    "above_ema_20",
    "pct_from_ema_20",
    "above_ema_50",
    "pct_from_ema_50",
    "above_ema_100",
    "pct_from_ema_100",
    "above_ema_200",
    "pct_from_ema_200",
    "ema_20_above_ema_50",
    "ema_50_above_ema_100",
    "ema_50_above_ema_200",
    "ema_100_above_ema_200",
  ] as const;

  const indRow = db
    .prepare(
      `
      SELECT
        price_change_1w_pct, price_change_1m_pct, price_change_3m_pct,
        price_change_6m_pct, price_change_12m_pct,
        atr_14, atr_pct_14, atr_21, atr_pct_21,
        ema_20, ema_50, ema_100, ema_200,
        above_ema_20, pct_from_ema_20, above_ema_50, pct_from_ema_50,
        above_ema_100, pct_from_ema_100, above_ema_200, pct_from_ema_200,
        ema_20_above_50 AS ema_20_above_ema_50,
        ema_50_above_100 AS ema_50_above_ema_100,
        ema_50_above_200 AS ema_50_above_ema_200,
        ema_100_above_200 AS ema_100_above_ema_200
      FROM indicators_daily
      WHERE symbol = ? AND date = ?
      `
    )
    .get(sym, priorDate) as Record<string, unknown> | undefined;

  const indicators_prior: Record<string, unknown> = {};
  if (indRow) {
    for (const k of indKeys) {
      indicators_prior[k] = indRow[k] ?? null;
    }
  }

  const indSparseRows = db
    .prepare(
      `
      SELECT date, atr_21, ema_20, ema_50, ema_200
      FROM indicators_daily
      WHERE symbol = ? AND date < ?
      ORDER BY date ASC
      `
    )
    .all(sym, analysisDate) as Array<{
    date: string;
    atr_21: number | null;
    ema_20: number | null;
    ema_50: number | null;
    ema_200: number | null;
  }>;

  const indicators_by_date: LargeCapDigestInputs["indicators_by_date"] = {};
  for (const row of indSparseRows) {
    indicators_by_date[String(row.date)] = {
      atr_21: num(row.atr_21),
      ema_20: num(row.ema_20),
      ema_50: num(row.ema_50),
      ema_200: num(row.ema_200),
    };
  }

  const quoteRow = db
    .prepare(
      "SELECT high_52w, off_52w_high_pct, prev_close FROM quote_daily WHERE symbol = ? AND date = ?"
    )
    .get(sym, priorDate) as Record<string, unknown> | undefined;

  const quote: Record<string, unknown> = quoteRow
    ? {
        high_52w: quoteRow.high_52w ?? null,
        off_52w_high_pct: quoteRow.off_52w_high_pct ?? null,
        prev_close: quoteRow.prev_close ?? null,
      }
    : {};

  return {
    analysis_date: analysisDate,
    db_latest_completed_session: dbLatest,
    company: { symbol: companyRow.symbol, name: companyRow.name },
    bars: bars.map((b) => ({
      date: String(b.date),
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: num(b.close),
      volume: b.volume != null ? Number(b.volume) : null,
    })),
    indicators_prior,
    indicators_by_date,
    quote,
  };
  });
}
