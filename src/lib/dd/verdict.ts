/**
 * Deterministic verdict + signal logic (spec §6.6). Computed in code from metrics +
 * dilution flags. The verdict is a dilution-and-solvency read, not buy/sell advice.
 */

import type { DDInstrument, DDSignalLevel, DDSignals, DDVerdict, DDVerdictResult } from "./types";

export type VerdictInputs = {
  runway_months: number | null;
  cash_flow_positive: boolean;
  float: number | null;
  overhang_pct: number | null;
  instruments: DDInstrument[];
  has_reverse_split_12mo: boolean;
};

function hasFlag(instruments: DDInstrument[], flag: string): boolean {
  return instruments.some((i) => i.flags.includes(flag) || i.primary_flag === flag);
}

/** Active ATM/ELOC facility currently selling into the market. */
function hasActiveFacility(instruments: DDInstrument[]): boolean {
  return instruments.some(
    (i) => (i.type === "ATM" || i.type === "ELOC") && (i.flags.includes("active") || i.status === "active")
  );
}

function hasAvailableFacility(instruments: DDInstrument[]): boolean {
  return instruments.some(
    (i) => (i.type === "ATM" || i.type === "ELOC") && i.flags.includes("available")
  );
}

function hasToxicOrDefault(instruments: DDInstrument[]): boolean {
  return hasFlag(instruments, "toxic") || hasFlag(instruments, "in-default");
}

export function computeFloatRisk(float: number | null): DDSignalLevel {
  if (float == null) return "low";
  if (float < 5_000_000) return "high";
  if (float <= 20_000_000) return "medium";
  return "low";
}

export function computeCashNeed(runwayMonths: number | null, cashFlowPositive: boolean): DDSignalLevel {
  if (cashFlowPositive) return "low";
  if (runwayMonths == null) return "low";
  if (runwayMonths < 6) return "high";
  if (runwayMonths <= 12) return "medium";
  return "low";
}

export function computeRaisePressure(
  runwayMonths: number | null,
  cashFlowPositive: boolean,
  instruments: DDInstrument[]
): DDSignalLevel {
  const shortRunway = runwayMonths != null && runwayMonths < 6;
  if (shortRunway || hasActiveFacility(instruments)) return "high";
  const midRunway = runwayMonths != null && runwayMonths >= 6 && runwayMonths <= 12;
  if ((midRunway && !cashFlowPositive) || hasAvailableFacility(instruments)) return "medium";
  return "low";
}

export function computeSignals(input: VerdictInputs): DDSignals {
  return {
    raise_pressure: computeRaisePressure(input.runway_months, input.cash_flow_positive, input.instruments),
    cash_need: computeCashNeed(input.runway_months, input.cash_flow_positive),
    float_risk: computeFloatRisk(input.float),
    overhang_pct: input.overhang_pct,
  };
}

/** Full verdict (spec §6.6). Reason joins the human labels of bearish conditions that fired. */
export function computeVerdict(input: VerdictInputs): DDVerdictResult {
  const { runway_months, cash_flow_positive, overhang_pct, instruments, has_reverse_split_12mo } = input;
  const shortRunway = runway_months != null && runway_months < 6;
  const activeFacility = hasActiveFacility(instruments);
  const toxicOrDefault = hasToxicOrDefault(instruments);
  const highOverhang = overhang_pct != null && overhang_pct >= 50;

  const bearishReasons: string[] = [];
  if (highOverhang) bearishReasons.push(`High overhang (${overhang_pct}%)`);
  if (shortRunway) bearishReasons.push("Short runway (<6mo)");
  if (hasFlag(instruments, "toxic")) bearishReasons.push("Toxic convertible");
  if (hasFlag(instruments, "in-default")) bearishReasons.push("Note in default");
  if (activeFacility) bearishReasons.push("Active dilution facility");
  if (has_reverse_split_12mo && activeFacility) bearishReasons.push("Recent reverse split");

  const isBearish = highOverhang || shortRunway || toxicOrDefault || (has_reverse_split_12mo && activeFacility);

  const lowOverhang = overhang_pct != null && overhang_pct < 20;
  const longRunway = cash_flow_positive || (runway_months != null && runway_months > 12);
  const isBullish =
    !activeFacility && longRunway && lowOverhang && !toxicOrDefault && !has_reverse_split_12mo;

  let verdict: DDVerdict;
  let reason: string;
  if (isBearish) {
    verdict = "Bearish";
    reason = bearishReasons.length > 0 ? bearishReasons.join(", ") : "Dilution / solvency risk";
  } else if (isBullish) {
    verdict = "Bullish";
    reason = "Clean balance sheet — no active dilution, long runway, low overhang";
  } else {
    verdict = "Neutral";
    reason = "Mixed dilution-and-solvency profile";
  }

  return { verdict, reason, signals: computeSignals(input) };
}
