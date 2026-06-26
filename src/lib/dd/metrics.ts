/**
 * Phase-1 fast metrics assembly (spec §5). Plain API calls + arithmetic, no AI.
 * Applies trader overrides (authoritative) on top of the prefilled figures.
 */

import { fetchCashOnHand, fetchOperatingCashFlowEntries, padCik, resolveCikFromTicker } from "./edgar";
import { resolveFloatPrefill } from "./float";
import {
  fetchDDShortInterest,
  fetchDDSnapshot,
  fetchDDSplits,
  fetchDDTickerDetails,
} from "./polygon";
import { computeRunway, computeTtmOperatingCashFlow } from "./runway";
import type { DDMetrics, DDOverride } from "./types";

export type BuildMetricsResult =
  | { found: false }
  | { found: true; metrics: DDMetrics; cik: string | null };

export function normalizeTicker(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s || s.length > 12) return null;
  if (!/^[-A-Z0-9.]+$/.test(s)) return null;
  return s;
}

export async function buildMetrics(
  ticker: string,
  override: DDOverride | null,
  signal?: AbortSignal
): Promise<BuildMetricsResult> {
  const warnings: string[] = [];

  // §5.1 + §5.2 in parallel.
  const [snapshot, details] = await Promise.all([
    fetchDDSnapshot(ticker, signal),
    fetchDDTickerDetails(ticker, signal),
  ]);

  if (!details.found && !snapshot.found) {
    return { found: false };
  }

  // CIK (Polygon → SEC fallback).
  let cik = details.cik;
  if (!cik) cik = await resolveCikFromTicker(ticker, signal);
  const paddedCik = cik ? padCik(cik) : null;

  // §5.3 float prefill + §5.6 short interest + §5.5 splits + §5.4 EDGAR, in parallel.
  const [floatPrefill, shortInterest, splits, cashOnHand, ocfEntries] = await Promise.all([
    resolveFloatPrefill(ticker, details.shares_outstanding, signal),
    fetchDDShortInterest(ticker, signal),
    fetchDDSplits(ticker, signal),
    paddedCik ? fetchCashOnHand(paddedCik, signal) : Promise.resolve(null),
    paddedCik ? fetchOperatingCashFlowEntries(paddedCik, signal) : Promise.resolve(null),
  ]);

  if (!paddedCik) warnings.push("Limited SEC coverage — no CIK resolved");
  else if (!cashOnHand && (!ocfEntries || ocfEntries.length === 0)) {
    warnings.push("Limited SEC coverage — cash/cash-flow XBRL not found (possible foreign filer)");
  }

  // Apply overrides (authoritative).
  const marketCap = override?.market_cap_override ?? details.market_cap;
  const marketCapSource = override?.market_cap_override != null ? "manual" : details.market_cap != null ? "polygon" : null;
  const float = override?.float_override ?? floatPrefill.float;
  const floatSource = override?.float_override != null ? "manual" : floatPrefill.source;

  // Short % of float (computed against the resolved float).
  let shortPctFloat: number | null = null;
  if (shortInterest.available && shortInterest.short_interest != null && float != null && float > 0) {
    shortPctFloat = Math.round((shortInterest.short_interest / float) * 1000) / 10;
  }
  if (!shortInterest.available) warnings.push("Short interest unavailable on current data plan");

  // §5.4 runway.
  const ttm = computeTtmOperatingCashFlow(ocfEntries);
  const runway = computeRunway(cashOnHand?.value ?? null, ttm.ttm);

  const metrics: DDMetrics = {
    ticker,
    name: details.name,
    cik: paddedCik,
    price: snapshot.price,
    prev_close: snapshot.prev_close,
    gap_pct: snapshot.gap_pct,
    market_cap: marketCap,
    market_cap_source: marketCapSource,
    float,
    float_source: floatSource,
    shares_outstanding: details.shares_outstanding,
    short_interest: shortInterest.short_interest,
    short_pct_float: shortPctFloat,
    short_interest_date: shortInterest.settlement_date,
    short_interest_unavailable: !shortInterest.available,
    cash_on_hand: cashOnHand?.value ?? null,
    ttm_operating_cf: ttm.ttm,
    monthly_burn: runway.monthly_burn,
    runway_months: runway.runway_months,
    cash_flow_positive: runway.cash_flow_positive,
    cash_as_of_date: cashOnHand?.asOf ?? null,
    splits,
    warnings,
  };

  return { found: true, metrics, cik: paddedCik };
}
