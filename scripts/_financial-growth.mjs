/**
 * Shared fiscal YoY growth helpers for Polygon income statements.
 * Quarterly: same fiscal period (Q1–Q4) vs prior calendar year; fallback by period_end alignment.
 * Annual: consecutive rows from API (period_end.desc) — prior fiscal year row.
 */

export function computeGrowth(current, prior) {
  if (current == null || !Number.isFinite(Number(current))) return null;
  if (prior == null || !Number.isFinite(Number(prior)) || Number(prior) === 0) return null;
  return ((Number(current) - Number(prior)) / Math.abs(Number(prior))) * 100;
}

export function parsePeriodEndYear(periodEnd) {
  if (typeof periodEnd !== "string" || periodEnd.length < 4) return null;
  const y = Number(periodEnd.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export function normalizeFiscalPeriod(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return v.length > 0 ? v : null;
}

/**
 * @param {object} currentRow - row with period_end, fiscal_period, fiscal_year, eps, revenue
 * @param {object[]} allRows - full quarterly series for one symbol (any order)
 */
export function getQuarterlyYoYPrior(currentRow, allRows) {
  const period = normalizeFiscalPeriod(currentRow.fiscal_period);
  const year =
    currentRow.fiscal_year != null && Number.isFinite(Number(currentRow.fiscal_year))
      ? Number(currentRow.fiscal_year)
      : parsePeriodEndYear(currentRow.period_end);

  if (period && year != null) {
    const prior = allRows.find((r) => {
      const rPeriod = normalizeFiscalPeriod(r.fiscal_period);
      const rYear =
        r.fiscal_year != null && Number.isFinite(Number(r.fiscal_year))
          ? Number(r.fiscal_year)
          : parsePeriodEndYear(r.period_end);
      return r !== currentRow && rPeriod === period && rYear === year - 1;
    });
    if (prior) return prior;
  }

  if (year == null) return null;
  const targetYear = year - 1;
  const targetMonthDay =
    typeof currentRow.period_end === "string" && currentRow.period_end.length >= 10
      ? currentRow.period_end.slice(5, 10)
      : null;
  const candidates = allRows.filter((r) => parsePeriodEndYear(r.period_end) === targetYear);
  if (candidates.length === 0) return null;
  if (targetMonthDay) {
    const exact = candidates.find(
      (r) => typeof r.period_end === "string" && r.period_end.slice(5, 10) === targetMonthDay
    );
    if (exact) return exact;
  }
  const currentTs = Date.parse(currentRow.period_end);
  if (!Number.isFinite(currentTs)) return candidates[0];
  const nearest = [...candidates].sort((a, b) => {
    const da = Math.abs(Date.parse(a.period_end) - currentTs);
    const db = Math.abs(Date.parse(b.period_end) - currentTs);
    return da - db;
  });
  return nearest[0] ?? null;
}

export function computeQuarterlyYoYGrowth(currentRow, allRows) {
  const prior = getQuarterlyYoYPrior(currentRow, allRows);
  return {
    epsGrowth: prior != null ? computeGrowth(currentRow.eps, prior.eps) : null,
    salesGrowth: prior != null ? computeGrowth(currentRow.revenue, prior.revenue) : null,
  };
}

export function computeAnnualYoYGrowth(currentRow, priorRow) {
  return {
    epsGrowth: priorRow != null ? computeGrowth(currentRow.eps, priorRow.eps) : null,
    salesGrowth: priorRow != null ? computeGrowth(currentRow.revenue, priorRow.revenue) : null,
  };
}
