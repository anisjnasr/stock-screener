/**
 * SSL fundamentals: Q/A and aggregates over quarterly/annual `financials` rows.
 */

import type { AstNode } from "./ast";
import type { EvalContext } from "./interpreter";
import type { SslFinancialRow } from "@/lib/screener-db-native";

export type Scalar = number | string | null;

/** Max stacked `[n]` period shifts for fundamental calls (quarters or years). */
export const MAX_FUND_PERIOD_LOOKBACK = 80;

const Q_FIELD_TO_KEY: Readonly<Record<string, keyof SslFinancialRow>> = {
  EPS: "eps",
  REVENUE: "sales",
  EPS_GROWTH_YOY: "eps_growth_yoy",
  REV_GROWTH_YOY: "sales_growth_yoy",
};

const A_FIELD_TO_KEY: Readonly<Record<string, keyof SslFinancialRow>> = {
  EPS_ANNUAL: "eps",
  REV_ANNUAL: "sales",
  EPS_GROWTH_ANNUAL: "eps_growth_yoy",
  REV_GROWTH_ANNUAL: "sales_growth_yoy",
};

const FUNDAMENTAL_CALL_NAMES = new Set([
  "Q",
  "AVG_Q",
  "MIN_Q",
  "MAX_Q",
  "SUM_Q",
  "STREAK_Q",
  "A",
  "AVG_A",
  "MIN_A",
  "MAX_A",
  "SUM_A",
  "STREAK_A",
]);

const ALL_FUNDAMENTAL_VAR_NAMES = new Set([
  ...Object.keys(Q_FIELD_TO_KEY),
  ...Object.keys(A_FIELD_TO_KEY),
]);

export function isFundamentalCallName(name: string): boolean {
  return FUNDAMENTAL_CALL_NAMES.has(name.toUpperCase());
}

/** True if `MA(EPS, …)`-style misuse: bare fundamental identifier as series. */
export function isBareFundamentalIdentifier(name: string): boolean {
  return ALL_FUNDAMENTAL_VAR_NAMES.has(name.toUpperCase());
}

function toNum(v: Scalar): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function resolveFieldKey(
  arg: AstNode,
  map: Readonly<Record<string, keyof SslFinancialRow>>
): keyof SslFinancialRow | null {
  if (arg.kind !== "variable" || arg.lookback !== null) return null;
  const key = map[arg.name.toUpperCase()];
  return key ?? null;
}

function rowValue(row: SslFinancialRow, col: keyof SslFinancialRow): number | null {
  if (col === "period_end") return null;
  const v = row[col];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Walk nested postfix `lookback` nodes; sum integer period offsets.
 * Offsets are validated by `evalOffset` (returns null if invalid).
 */
export function unwrapLookbackChain(
  node: AstNode,
  evalOffset: (off: AstNode) => number | null
): { inner: AstNode; periodShift: number } | null {
  let sum = 0;
  let cur: AstNode = node;
  while (cur.kind === "lookback") {
    const n = evalOffset(cur.offset);
    if (n === null) return null;
    sum += n;
    cur = cur.target;
  }
  return { inner: cur, periodShift: sum };
}

export function evalFundamentalCall(
  node: AstNode & { kind: "call" },
  ctx: EvalContext,
  periodShift: number,
  barIdx: number,
  evalScalarAt: (n: AstNode, c: EvalContext, b: number) => Scalar
): Scalar {
  const name = node.name.toUpperCase();
  const args = node.args;
  const fund = ctx.fundamentals;
  if (!fund) return null;

  if (periodShift < 0 || !Number.isInteger(periodShift) || periodShift > MAX_FUND_PERIOD_LOOKBACK) {
    return null;
  }

  if (name === "STREAK_Q" || name === "STREAK_A") return null;

  const isQ =
    name === "Q" ||
    name === "AVG_Q" ||
    name === "MIN_Q" ||
    name === "MAX_Q" ||
    name === "SUM_Q";
  const isA =
    name === "A" ||
    name === "AVG_A" ||
    name === "MIN_A" ||
    name === "MAX_A" ||
    name === "SUM_A";

  const series = isQ ? fund.quarterly : isA ? fund.annual : null;
  const fieldMap = isQ ? Q_FIELD_TO_KEY : isA ? A_FIELD_TO_KEY : null;
  if (!series || !fieldMap) return null;

  if (name === "Q" || name === "A") {
    if (args.length < 2) return null;
    const col = resolveFieldKey(args[0]!, fieldMap);
    if (!col) return null;
    const idxRaw = toNum(evalScalarAt(args[1]!, ctx, barIdx));
    if (idxRaw === null || idxRaw < 0 || !Number.isInteger(idxRaw)) return null;
    const idx = idxRaw + periodShift;
    if (idx < 0 || idx >= series.length) return null;
    const v = rowValue(series[idx]!, col);
    return v;
  }

  // AVG_/MIN_/MAX_/SUM_ — (field, count)
  if (args.length < 2) return null;
  const col = resolveFieldKey(args[0]!, fieldMap);
  if (!col) return null;
  const countRaw = toNum(evalScalarAt(args[1]!, ctx, barIdx));
  if (countRaw === null || countRaw < 1 || !Number.isInteger(countRaw)) return null;
  const count = countRaw;
  const start = periodShift;
  if (start < 0 || start + count > series.length) return null;

  const vals: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = rowValue(series[start + i]!, col);
    if (v === null) return null;
    vals.push(v);
  }

  if (name === "AVG_Q" || name === "AVG_A") {
    const s = vals.reduce((a, b) => a + b, 0);
    return s / count;
  }
  if (name === "SUM_Q" || name === "SUM_A") {
    return vals.reduce((a, b) => a + b, 0);
  }
  if (name === "MIN_Q" || name === "MIN_A") {
    return Math.min(...vals);
  }
  if (name === "MAX_Q" || name === "MAX_A") {
    return Math.max(...vals);
  }

  return null;
}
