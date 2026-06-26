/**
 * Cash-runway math (spec §5.4) — TTM operating cash-flow rollforward + runway.
 * Pure functions, unit-tested. No I/O.
 */

import type { XbrlUsdEntry } from "./edgar";

const DAY_MS = 86_400_000;

function durationDays(e: XbrlUsdEntry): number | null {
  if (!e.start || !e.end) return null;
  const start = Date.parse(e.start);
  const end = Date.parse(e.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / DAY_MS);
}

function isAnnual(e: XbrlUsdEntry): boolean {
  const d = durationDays(e);
  return d != null && d >= 330 && d <= 400;
}

export type TtmMethod = "annual_only" | "rollforward" | "insufficient";

export type TtmResult = {
  ttm: number | null;
  method: TtmMethod;
  /** Components used (for debugging / notes). */
  components: {
    last_full_year?: number;
    prior_year_partial?: number;
    current_year_partial?: number;
  };
};

/**
 * TTM = lastFullYear (10-K annual) − priorYearPartial (YTD same period last year)
 *       + currentYearPartial (latest YTD this year).
 * If the latest data is a single annual period, TTM = that annual value.
 */
export function computeTtmOperatingCashFlow(entries: XbrlUsdEntry[] | null | undefined): TtmResult {
  const usable = (entries ?? []).filter((e) => e.end && typeof e.val === "number");
  if (usable.length === 0) return { ttm: null, method: "insufficient", components: {} };

  const sorted = [...usable].sort((a, b) => b.end.localeCompare(a.end));
  const latest = sorted[0]!;

  // Only a (most recent) full year available, or the latest reported period IS the full year.
  if (isAnnual(latest)) {
    return { ttm: latest.val, method: "annual_only", components: { last_full_year: latest.val } };
  }

  const current = latest; // latest partial YTD this year
  const curDur = durationDays(current);
  const curEndMs = Date.parse(current.end);

  // Most recent completed full year that ended on/before the current partial began.
  const lastFullYear = sorted.find((e) => isAnnual(e) && e.end < current.end) ?? null;

  // Prior-year partial: same duration (±45d), ending ~1 year before the current partial.
  const priorYearPartial =
    curDur != null && Number.isFinite(curEndMs)
      ? sorted.find((e) => {
          if (e === current || isAnnual(e)) return false;
          const d = durationDays(e);
          if (d == null || Math.abs(d - curDur) > 45) return false;
          const endMs = Date.parse(e.end);
          if (!Number.isFinite(endMs) || endMs >= curEndMs) return false;
          const gapDays = Math.round((curEndMs - endMs) / DAY_MS);
          return gapDays >= 320 && gapDays <= 410;
        }) ?? null
      : null;

  if (lastFullYear && priorYearPartial) {
    const ttm = lastFullYear.val - priorYearPartial.val + current.val;
    return {
      ttm,
      method: "rollforward",
      components: {
        last_full_year: lastFullYear.val,
        prior_year_partial: priorYearPartial.val,
        current_year_partial: current.val,
      },
    };
  }

  // Fallback: a recent annual exists but no matching prior-year partial — use the annual alone.
  if (lastFullYear) {
    return { ttm: lastFullYear.val, method: "annual_only", components: { last_full_year: lastFullYear.val } };
  }

  return { ttm: null, method: "insufficient", components: {} };
}

export type RunwayResult = {
  /** Positive when burning cash (TTM OCF negative); null when not computable. */
  monthly_burn: number | null;
  /** Months of cash left (1dp); null when profitable or not computable. */
  runway_months: number | null;
  cash_flow_positive: boolean;
};

/** §5.4 — runway from cash on hand and TTM operating cash flow. */
export function computeRunway(
  cashOnHand: number | null | undefined,
  ttmOperatingCashFlow: number | null | undefined
): RunwayResult {
  if (typeof ttmOperatingCashFlow !== "number" || !Number.isFinite(ttmOperatingCashFlow)) {
    return { monthly_burn: null, runway_months: null, cash_flow_positive: false };
  }
  // Cash-flow positive → "Profitable / n/a", no runway number.
  if (ttmOperatingCashFlow >= 0) {
    return { monthly_burn: null, runway_months: null, cash_flow_positive: true };
  }
  const monthlyBurn = -ttmOperatingCashFlow / 12; // positive
  if (typeof cashOnHand !== "number" || !Number.isFinite(cashOnHand) || monthlyBurn <= 0) {
    return { monthly_burn: Math.round(monthlyBurn), runway_months: null, cash_flow_positive: false };
  }
  const runwayMonths = Math.round((cashOnHand / monthlyBurn) * 10) / 10;
  return { monthly_burn: Math.round(monthlyBurn), runway_months: runwayMonths, cash_flow_positive: false };
}

/** Runway color bucket (spec §5.4): <6 red, 6–12 amber, >12 green. */
export function runwaySeverity(runwayMonths: number | null): "red" | "amber" | "green" | null {
  if (runwayMonths == null) return null;
  if (runwayMonths < 6) return "red";
  if (runwayMonths <= 12) return "amber";
  return "green";
}
