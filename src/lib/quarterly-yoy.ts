/**
 * Quarterly YoY growth vs same quarter prior year (revenue/sales and EPS).
 * Ported from scripts/_financial-growth.mjs with a safer fallback when fiscal tags
 * are missing: prefer same calendar month-day in prior year, then ±14d around
 * period_end minus one calendar year — not "nearest any date" in the prior year
 * (which could pick the adjacent quarter / QoQ-like base).
 */

export function computeGrowthPct(current: number | null, prior: number | null): number | null {
  if (current == null || !Number.isFinite(Number(current))) return null;
  if (prior == null || !Number.isFinite(Number(prior)) || Number(prior) === 0) return null;
  return ((Number(current) - Number(prior)) / Math.abs(Number(prior))) * 100;
}

function parsePeriodEndYear(periodEnd: string): number | null {
  if (typeof periodEnd !== "string" || periodEnd.length < 4) return null;
  const y = Number(periodEnd.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function normalizeFiscalPeriod(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (!v.length) return null;
  const m = /^Q?([1-4])$/.exec(v);
  if (m) return `Q${m[1]}`;
  return v;
}

/** ISO date YYYY-MM-DD, UTC, minus one calendar year (handles leap years). */
function isoDateMinusOneYear(isoDate: string): string | null {
  if (isoDate.length < 10) return null;
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export type QuarterlyFinancialRow = {
  period_end: string;
  eps: number | null;
  /** Revenue (same as DB `sales`). */
  sales: number | null;
  fiscal_period?: string | null;
  fiscal_year?: number | null;
};

/**
 * Find the prior-year comparable quarter row. Uses fiscal_period + fiscal_year when
 * possible; otherwise same MM-DD in prior calendar year, then ±14d around one-year-ago date.
 */
export function getQuarterlyYoYPrior<T extends QuarterlyFinancialRow>(currentRow: T, allRows: T[]): T | null {
  const period = normalizeFiscalPeriod(currentRow.fiscal_period ?? undefined);
  const year =
    currentRow.fiscal_year != null && Number.isFinite(Number(currentRow.fiscal_year))
      ? Number(currentRow.fiscal_year)
      : parsePeriodEndYear(currentRow.period_end);

  if (period != null && year != null) {
    const prior = allRows.find((r) => {
      if (r.period_end === currentRow.period_end) return false;
      const rPeriod = normalizeFiscalPeriod(r.fiscal_period ?? undefined);
      const rYear =
        r.fiscal_year != null && Number.isFinite(Number(r.fiscal_year))
          ? Number(r.fiscal_year)
          : parsePeriodEndYear(r.period_end);
      return rPeriod === period && rYear === year - 1;
    });
    if (prior) return prior;
  }

  const calYear = parsePeriodEndYear(currentRow.period_end);
  if (calYear == null) return null;
  const targetCalYear = calYear - 1;
  const targetMonthDay =
    typeof currentRow.period_end === "string" && currentRow.period_end.length >= 10
      ? currentRow.period_end.slice(5, 10)
      : null;

  const candidates = allRows.filter(
    (r) => r.period_end !== currentRow.period_end && parsePeriodEndYear(r.period_end) === targetCalYear
  );
  if (candidates.length === 0) return null;

  if (targetMonthDay) {
    const exactMd = candidates.find((r) => typeof r.period_end === "string" && r.period_end.slice(5, 10) === targetMonthDay);
    if (exactMd) return exactMd;
  }

  const anchor = isoDateMinusOneYear(currentRow.period_end);
  if (!anchor) return null;
  const anchorTs = Date.parse(`${anchor}T12:00:00.000Z`);
  if (!Number.isFinite(anchorTs)) return null;

  let best: T | null = null;
  let bestDelta = Infinity;
  for (const r of candidates) {
    const t = Date.parse(`${r.period_end.slice(0, 10)}T12:00:00.000Z`);
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - anchorTs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = r;
    }
  }
  const fourteenDaysMs = 14 * 86400000;
  if (best && bestDelta <= fourteenDaysMs) return best;

  return null;
}

export function computeQuarterlyYoYGrowthPct(currentRow: QuarterlyFinancialRow, allRows: QuarterlyFinancialRow[]): {
  epsGrowth: number | null;
  salesGrowth: number | null;
} {
  const prior = getQuarterlyYoYPrior(currentRow, allRows);
  return {
    epsGrowth: prior != null ? computeGrowthPct(currentRow.eps, prior.eps) : null,
    salesGrowth: prior != null ? computeGrowthPct(currentRow.sales, prior.sales) : null,
  };
}

/** Recompute YoY % for each quarterly row from the full series (same symbol). */
export function recalculateQuarterlyYoYForSeries<
  T extends {
    period_end: string;
    period_type: "annual" | "quarterly";
    eps: number | null;
    eps_growth_yoy: number | null;
    sales: number | null;
    sales_growth_yoy: number | null;
    fiscal_period?: string | null;
    fiscal_year?: number | null;
  },
>(rows: T[]): T[] {
  const quarterly = rows.filter((r) => r.period_type === "quarterly");
  if (quarterly.length === 0) return rows;

  const inputs: QuarterlyFinancialRow[] = quarterly.map((r) => ({
    period_end: r.period_end,
    eps: r.eps,
    sales: r.sales,
    fiscal_period: r.fiscal_period ?? null,
    fiscal_year: r.fiscal_year ?? null,
  }));

  return rows.map((row) => {
    if (row.period_type !== "quarterly") return row;
    const input = inputs.find((i) => i.period_end === row.period_end);
    if (!input) return row;
    const { epsGrowth, salesGrowth } = computeQuarterlyYoYGrowthPct(input, inputs);
    return {
      ...row,
      eps_growth_yoy: epsGrowth,
      sales_growth_yoy: salesGrowth,
    };
  });
}
