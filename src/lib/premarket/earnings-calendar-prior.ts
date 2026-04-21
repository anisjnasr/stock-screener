import type { SupabaseClient } from "@supabase/supabase-js";
import { prevQuarter } from "@/lib/sources/finnhubEarnings";

export type PriorActualFields = {
  prior_eps_actual: number | null;
  prior_revenue_actual: number | null;
};

/**
 * Fill prior-quarter EPS/revenue actuals from existing `earnings_calendar` rows (same ticker, Q-1).
 */
export async function attachPriorQuarterActuals<T extends PriorActualFields & { ticker: string; quarter: number | null; year: number | null }>(
  supabase: SupabaseClient,
  rows: T[]
): Promise<void> {
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  if (!tickers.length) return;

  const { data, error } = await supabase
    .from("earnings_calendar")
    .select("ticker, quarter, year, eps_actual, revenue_actual")
    .in("ticker", tickers)
    .limit(50_000);

  if (error) {
    console.warn("[earnings-calendar] prior actual lookup:", error.message);
    return;
  }

  const map = new Map<string, { eps: number | null; rev: number | null }>();
  for (const d of data ?? []) {
    const row = d as {
      ticker: string;
      quarter: number | null;
      year: number | null;
      eps_actual: number | string | null;
      revenue_actual: number | string | null;
    };
    if (row.quarter == null || row.year == null) continue;
    const k = `${String(row.ticker).toUpperCase()}:${row.year}:${row.quarter}`;
    map.set(k, {
      eps: row.eps_actual != null ? Number(row.eps_actual) : null,
      rev: row.revenue_actual != null ? Number(row.revenue_actual) : null,
    });
  }

  for (const r of rows) {
    r.prior_eps_actual = null;
    r.prior_revenue_actual = null;
    if (r.quarter == null || r.year == null) continue;
    const p = prevQuarter(r.quarter, r.year);
    const hit = map.get(`${r.ticker}:${p.year}:${p.quarter}`);
    if (!hit) continue;
    r.prior_eps_actual = hit.eps != null && Number.isFinite(hit.eps) ? hit.eps : null;
    r.prior_revenue_actual = hit.rev != null && Number.isFinite(hit.rev) ? hit.rev : null;
  }
}
