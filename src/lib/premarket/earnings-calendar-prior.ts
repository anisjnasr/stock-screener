import type { SupabaseClient } from "@supabase/supabase-js";
import { prevQuarter } from "@/lib/sources/finnhubEarnings";

export type PriorActualFields = {
  prior_eps_actual: number | null;
  prior_revenue_actual: number | null;
};

export type PriorAttachRow = PriorActualFields & {
  ticker: string;
  quarter: number | null;
  year: number | null;
  report_date: string;
};

/**
 * Fill prior-quarter EPS/revenue actuals from existing `earnings_calendar` rows (same ticker, fiscal Q-1).
 * Fallback: if fiscal key misses (common when quarter/year is calendar-derived), use the latest prior
 * `report_date` row for the same ticker with any actuals.
 */
export async function attachPriorQuarterActuals<T extends PriorAttachRow>(supabase: SupabaseClient, rows: T[]): Promise<void> {
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  if (!tickers.length) return;

  const { data, error } = await supabase
    .from("earnings_calendar")
    .select("ticker, quarter, year, report_date, eps_actual, revenue_actual")
    .in("ticker", tickers)
    .limit(50_000);

  if (error) {
    console.warn("[earnings-calendar] prior actual lookup:", error.message);
    return;
  }

  const map = new Map<string, { eps: number | null; rev: number | null }>();
  const byTickerTimeline: Map<string, { report_date: string; eps: number | null; rev: number | null }[]> = new Map();

  for (const d of data ?? []) {
    const row = d as {
      ticker: string;
      quarter: number | null;
      year: number | null;
      report_date: string;
      eps_actual: number | string | null;
      revenue_actual: number | string | null;
    };
    const t = String(row.ticker ?? "").toUpperCase();
    const rd = String(row.report_date ?? "").slice(0, 10);
    const eps = row.eps_actual != null ? Number(row.eps_actual) : null;
    const rev = row.revenue_actual != null ? Number(row.revenue_actual) : null;

    if (row.quarter != null && row.year != null) {
      const k = `${t}:${row.year}:${row.quarter}`;
      map.set(k, {
        eps: eps != null && Number.isFinite(eps) ? eps : null,
        rev: rev != null && Number.isFinite(rev) ? rev : null,
      });
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(rd)) {
      let arr = byTickerTimeline.get(t);
      if (!arr) {
        arr = [];
        byTickerTimeline.set(t, arr);
      }
      arr.push({
        report_date: rd,
        eps: eps != null && Number.isFinite(eps) ? eps : null,
        rev: rev != null && Number.isFinite(rev) ? rev : null,
      });
    }
  }

  for (const arr of byTickerTimeline.values()) {
    arr.sort((a, b) => a.report_date.localeCompare(b.report_date));
  }

  for (const r of rows) {
    r.prior_eps_actual = null;
    r.prior_revenue_actual = null;
    if (r.quarter != null && r.year != null) {
      const p = prevQuarter(r.quarter, r.year);
      const hit = map.get(`${r.ticker}:${p.year}:${p.quarter}`);
      if (hit) {
        r.prior_eps_actual = hit.eps != null && Number.isFinite(hit.eps) ? hit.eps : null;
        r.prior_revenue_actual = hit.rev != null && Number.isFinite(hit.rev) ? hit.rev : null;
      }
    }

    const needEps = r.prior_eps_actual == null;
    const needRev = r.prior_revenue_actual == null;
    if (!needEps && !needRev) continue;

    const arr = byTickerTimeline.get(r.ticker);
    if (!arr?.length) continue;
    const rd = String(r.report_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rd)) continue;

    const candidates = arr.filter((x) => x.report_date < rd && (x.eps != null || x.rev != null));
    candidates.sort((a, b) => b.report_date.localeCompare(a.report_date));
    const best = candidates[0];
    if (!best) continue;
    if (needEps && best.eps != null) r.prior_eps_actual = best.eps;
    if (needRev && best.rev != null) r.prior_revenue_actual = best.rev;
  }
}
