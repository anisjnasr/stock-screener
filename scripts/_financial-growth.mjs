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
  if (!v.length) return null;
  const m = /^Q?([1-4])$/.exec(v);
  if (m) return `Q${m[1]}`;
  return v;
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
      if (r.period_end === currentRow.period_end) return false;
      const rPeriod = normalizeFiscalPeriod(r.fiscal_period);
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
    const exactMd = candidates.find(
      (r) => typeof r.period_end === "string" && r.period_end.slice(5, 10) === targetMonthDay
    );
    if (exactMd) return exactMd;
  }
  const anchorIso = isoDateMinusOneYear(currentRow.period_end.slice(0, 10));
  if (!anchorIso) return null;
  const anchorTs = Date.parse(`${anchorIso}T12:00:00.000Z`);
  if (!Number.isFinite(anchorTs)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const r of candidates) {
    const t = Date.parse(`${String(r.period_end).slice(0, 10)}T12:00:00.000Z`);
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

function isoDateMinusOneYear(isoDate) {
  if (typeof isoDate !== "string" || isoDate.length < 10) return null;
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
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
