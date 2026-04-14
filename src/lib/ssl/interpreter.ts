/**
 * SSL interpreter: evaluates expressions on daily bars (newest-first at index 0).
 */

import type { AstNode, ScriptAst } from "./ast";
import type { SslFinancialSeries } from "@/lib/screener-db-native";
import {
  evalFundamentalCall,
  isBareFundamentalIdentifier,
  isFundamentalCallName,
  MAX_FUND_PERIOD_LOOKBACK,
  unwrapLookbackChain,
} from "./fundamentals";

export type Bar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SnapshotData = Record<string, number | string | null>;

export type EvalContext = {
  bars: Bar[];
  variables: Record<string, number>;
  snapshot?: SnapshotData;
  /** Ticker symbol for NAME and similar. */
  symbol?: string;
  /** Quarterly/annual fundamentals for Q(), A(), etc. */
  fundamentals?: SslFinancialSeries;
};

const SERIES_IDS = new Set([
  "P",
  "C",
  "CLOSE",
  "O",
  "OPEN",
  "H",
  "HIGH",
  "L",
  "LOW",
  "V",
  "VOLUME",
]);

const SERIES_KEYS: Record<string, keyof Bar> = {
  P: "close",
  C: "close",
  CLOSE: "close",
  O: "open",
  OPEN: "open",
  H: "high",
  HIGH: "high",
  L: "low",
  LOW: "low",
  V: "volume",
  VOLUME: "volume",
};

const SNAPSHOT_NUMERIC: Record<string, string> = {
  MARKET_CAP: "market_cap",
  MC: "market_cap",
  /** Mean daily dollar volume (~21 sessions), from indicators_daily. */
  DADV1M: "avg_dollar_volume_1m",
  /** Mean daily dollar volume (~63 sessions), from indicators_daily. */
  DADV3M: "avg_dollar_volume_3m",
  DAYS_SINCE_IPO: "days_since_ipo",
  SHARES_OUT: "shares_outstanding",
};

const SNAPSHOT_STRING: Record<string, string> = {
  IPO_DATE: "ipo_date",
  IPODATE: "ipo_date",
  SECTOR: "sector",
  INDUSTRY: "industry",
};

/**
 * RS(period) → precomputed RS vs SPY percentile (0–100) columns.
 * Period codes: 0 = 1 week; 1, 3, 6, 12 = calendar months (matches snapshot / screener data).
 */
const RS_PERIOD_TO_FIELD: Record<number, string> = {
  0: "rs_pct_1w",
  1: "rs_pct_1m",
  3: "rs_pct_3m",
  6: "rs_pct_6m",
  12: "rs_pct_12m",
};

/** IndRank(period) → industry leaderboard rank (1 = best). Only monthly horizons exist in data. */
const INDRANK_PERIOD_TO_FIELD: Record<number, string> = {
  1: "industry_rank_1m",
  3: "industry_rank_3m",
  6: "industry_rank_6m",
  12: "industry_rank_12m",
};

const RS_ALLOWED_PERIODS = new Set(Object.keys(RS_PERIOD_TO_FIELD).map(Number));
const INDRANK_ALLOWED_PERIODS = new Set(Object.keys(INDRANK_PERIOD_TO_FIELD).map(Number));

const MAX_LOOKBACK = 500;

export function getSeriesValue(bars: Bar[], barIndex: number, name: string): number | null {
  if (barIndex < 0 || barIndex >= bars.length) return null;
  const key = SERIES_KEYS[name];
  if (!key) return null;
  const v = bars[barIndex]![key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

type EvalValue = number | string | null;

function toNumber(v: EvalValue): number | null {
  if (typeof v === "number") return v;
  return null;
}

function compareDateStrings(a: string, b: string): number {
  const da = new Date(a + (a.length === 10 ? "T00:00:00Z" : ""));
  const db = new Date(b + (b.length === 10 ? "T00:00:00Z" : ""));
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return NaN;
  return da.getTime() - db.getTime();
}

/** Evaluate numeric/string at bar index `barIdx` (0 = most recent). */
export function evalScalarAt(node: AstNode, ctx: EvalContext, barIdx: number): EvalValue {
  switch (node.kind) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "variable": {
      let idx = barIdx;
      if (node.lookback !== null) {
        const n = toNumber(evalScalarAt(node.lookback, ctx, barIdx));
        if (n === null || n < 0 || !Number.isInteger(n) || n > MAX_LOOKBACK) return null;
        idx = barIdx + n;
      }
      const nm = node.name;
      if (SERIES_IDS.has(nm)) {
        return getSeriesValue(ctx.bars, idx, nm);
      }
      if (nm === "ADV") {
        return computeAdv(ctx.bars, idx);
      }
      if (nm === "NAME") {
        return ctx.symbol ?? null;
      }
      if (SNAPSHOT_NUMERIC[nm] && ctx.snapshot) {
        const k = SNAPSHOT_NUMERIC[nm]!;
        const v = ctx.snapshot[k];
        return typeof v === "number" ? v : null;
      }
      if (SNAPSHOT_STRING[nm] && ctx.snapshot) {
        const k = SNAPSHOT_STRING[nm]!;
        if (nm === "NAME" && ctx.symbol) return ctx.symbol;
        const v = ctx.snapshot[k];
        return typeof v === "string" ? v : null;
      }
      const v = ctx.variables[nm];
      return v !== undefined && typeof v === "number" ? v : null;
    }
    case "binary": {
      if (node.op === "AND" || node.op === "OR") {
        const a = evalScalarAt(node.left, ctx, barIdx);
        const b = evalScalarAt(node.right, ctx, barIdx);
        const ba = a !== null && a !== 0 && a !== "";
        const bb = b !== null && b !== 0 && b !== "";
        if (node.op === "AND") return ba && bb ? 1 : 0;
        return ba || bb ? 1 : 0;
      }
      const left = evalScalarAt(node.left, ctx, barIdx);
      const right = evalScalarAt(node.right, ctx, barIdx);
      if (left === null || right === null) return null;

      if (typeof left === "string" || typeof right === "string") {
        const ls = String(left);
        const rs = String(right);
        const isDateCompare =
          (typeof left === "string" && /^\d{4}-\d{2}-\d{2}/.test(ls)) ||
          (typeof right === "string" && /^\d{4}-\d{2}-\d{2}/.test(rs));
        if (isDateCompare) {
          const diff = compareDateStrings(ls, rs);
          if (isNaN(diff)) return null;
          switch (node.op) {
            case ">":
              return diff > 0 ? 1 : 0;
            case "<":
              return diff < 0 ? 1 : 0;
            case ">=":
              return diff >= 0 ? 1 : 0;
            case "<=":
              return diff <= 0 ? 1 : 0;
            case "==":
              return diff === 0 ? 1 : 0;
            case "!=":
            case "<>":
              return diff !== 0 ? 1 : 0;
            default:
              return null;
          }
        }
        switch (node.op) {
          case "==":
            return ls === rs ? 1 : 0;
          case "!=":
          case "<>":
            return ls !== rs ? 1 : 0;
          default:
            return null;
        }
      }

      const ln = left as number;
      const rn = right as number;
      switch (node.op) {
        case "+":
          return ln + rn;
        case "-":
          return ln - rn;
        case "*":
          return ln * rn;
        case "/":
          return rn === 0 ? null : ln / rn;
        case "%":
          return rn === 0 ? null : ln % rn;
        case "^":
          return ln ** rn;
        case ">":
          return ln > rn ? 1 : 0;
        case "<":
          return ln < rn ? 1 : 0;
        case ">=":
          return ln >= rn ? 1 : 0;
        case "<=":
          return ln <= rn ? 1 : 0;
        case "==":
          return ln === rn ? 1 : 0;
        case "!=":
        case "<>":
          return ln !== rn ? 1 : 0;
        default:
          return null;
      }
    }
    case "unary": {
      const operand = toNumber(evalScalarAt(node.operand, ctx, barIdx));
      if (operand === null) return null;
      if (node.op === "NOT") return operand !== 0 ? 0 : 1;
      if (node.op === "-") return -operand;
      return null;
    }
    case "call":
      return evalCallAt(node, ctx, barIdx);
    case "lookback": {
      const unwrapped = unwrapLookbackChain(node, (off) => {
        const n = toNumber(evalScalarAt(off, ctx, barIdx));
        if (n === null || n < 0 || !Number.isInteger(n) || n > MAX_FUND_PERIOD_LOOKBACK) return null;
        return n;
      });
      if (!unwrapped) return null;
      const { inner, periodShift } = unwrapped;
      if (inner.kind === "call" && isFundamentalCallName(inner.name)) {
        return evalFundamentalCall(inner, ctx, periodShift, barIdx, evalScalarAt);
      }
      if (periodShift > MAX_LOOKBACK) return null;
      return evalScalarAt(inner, ctx, barIdx + periodShift);
    }
    default:
      return null;
  }
}

function computeAdv(bars: Bar[], centerIdx: number): number | null {
  const period = Math.min(50, bars.length - centerIdx);
  if (period < 1) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    const v = bars[centerIdx + i]?.volume;
    if (typeof v !== "number") return null;
    sum += v;
  }
  return sum / period;
}

/** Whole-number period only (e.g. RS(3), RS(0); not RS(2.5)). */
function evalDiscretePeriodArg(
  arg: AstNode,
  ctx: EvalContext,
  barIdx: number,
  allowed: ReadonlySet<number>
): number | null {
  const raw = toNumber(evalScalarAt(arg, ctx, barIdx));
  if (raw === null || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  if (Math.abs(raw - n) > 1e-9) return null;
  if (!allowed.has(n)) return null;
  return n;
}

function snapshotNumericField(ctx: EvalContext, field: string): number | null {
  if (!ctx.snapshot) return null;
  const v = ctx.snapshot[field];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function evalCallAt(node: AstNode & { kind: "call" }, ctx: EvalContext, barIdx: number): EvalValue {
  const name = node.name;
  const args = node.args;

  if (name === "RS") {
    if (args.length < 1) return null;
    const period = evalDiscretePeriodArg(args[0]!, ctx, barIdx, RS_ALLOWED_PERIODS);
    if (period === null) return null;
    const field = RS_PERIOD_TO_FIELD[period];
    if (!field) return null;
    return snapshotNumericField(ctx, field);
  }

  if (name === "INDRANK" || name === "INDRS" || name === "INDUSTRYRANK") {
    if (args.length < 1) return null;
    const period = evalDiscretePeriodArg(args[0]!, ctx, barIdx, INDRANK_ALLOWED_PERIODS);
    if (period === null) return null;
    const field = INDRANK_PERIOD_TO_FIELD[period];
    if (!field) return null;
    return snapshotNumericField(ctx, field);
  }

  if (name === "REF" && args.length >= 2) {
    const periods = toNumber(evalScalarAt(args[1]!, ctx, barIdx));
    if (periods === null || periods > 0) return null;
    const off = -periods;
    return evalScalarAt(args[0]!, ctx, barIdx + off);
  }

  if (name === "IIF" && args.length >= 3) {
    const t = evalScalarAt(args[1]!, ctx, barIdx);
    const f = evalScalarAt(args[2]!, ctx, barIdx);
    const cond = evalScalarAt(args[0]!, ctx, barIdx);
    return cond !== null && cond !== 0 && cond !== "" ? t : f;
  }

  if (name === "ABS" && args.length >= 1) {
    const x = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    return x === null ? null : Math.abs(x);
  }

  if ((name === "MAX" || name === "MIN") && args.length === 2) {
    const a = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    const b = toNumber(evalScalarAt(args[1]!, ctx, barIdx));
    if (a === null || b === null) return null;
    return name === "MAX" ? Math.max(a, b) : Math.min(a, b);
  }

  if (name === "SQRT" && args.length >= 1) {
    const x = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    if (x === null || x < 0) return null;
    return Math.sqrt(x);
  }

  if (name === "LOG" && args.length >= 1) {
    const x = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    if (x === null || x <= 0) return null;
    return Math.log(x);
  }

  if (name === "ROUND" && args.length >= 2) {
    const x = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    const d = toNumber(evalScalarAt(args[1]!, ctx, barIdx));
    if (x === null || d === null || d < 0 || !Number.isInteger(d)) return null;
    const p = 10 ** d;
    return Math.round(x * p) / p;
  }

  if (name === "CROSS" && args.length >= 2) {
    const a0 = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    const b0 = toNumber(evalScalarAt(args[1]!, ctx, barIdx));
    const a1 = toNumber(evalScalarAt(args[0]!, ctx, barIdx + 1));
    const b1 = toNumber(evalScalarAt(args[1]!, ctx, barIdx + 1));
    if (a0 === null || b0 === null || a1 === null || b1 === null) return null;
    return a0 > b0 && a1 <= b1 ? 1 : 0;
  }

  if (name === "CROSSBELOW" && args.length >= 2) {
    const a0 = toNumber(evalScalarAt(args[0]!, ctx, barIdx));
    const b0 = toNumber(evalScalarAt(args[1]!, ctx, barIdx));
    const a1 = toNumber(evalScalarAt(args[0]!, ctx, barIdx + 1));
    const b1 = toNumber(evalScalarAt(args[1]!, ctx, barIdx + 1));
    if (a0 === null || b0 === null || a1 === null || b1 === null) return null;
    return a0 < b0 && a1 >= b1 ? 1 : 0;
  }

  if (name === "RSI" && args.length >= 1) {
    const period = Math.floor(toNumber(evalScalarAt(args[0]!, ctx, barIdx)) ?? 0);
    return rsiAt(ctx.bars, barIdx, period);
  }

  const numArgs = args.map((a) => toNumber(evalScalarAt(a, ctx, barIdx)));

  if (name === "ATR" || name === "ATRP") {
    const period = Math.floor(numArgs[0] ?? 0);
    if (period < 1 || ctx.bars.length < period + 1 + barIdx) return null;
    const atr = atrWilderSlice(ctx.bars, barIdx, period);
    if (atr === null) return null;
    if (name === "ATRP") {
      const c = getSeriesValue(ctx.bars, barIdx, "C");
      return c === null || c === 0 ? null : (atr / c) * 100;
    }
    return atr;
  }

  if (name === "VWAP") {
    return vwapFrom(ctx.bars, barIdx);
  }

  if (name === "BARSSINCE" && args.length >= 1) {
    for (let i = barIdx; i < ctx.bars.length; i++) {
      const v = evalScalarAt(args[0]!, ctx, i);
      if (v !== null && v !== 0 && v !== "") return i - barIdx;
    }
    return null;
  }

  if ((name === "BBTOP" || name === "BBBOT") && args.length >= 2) {
    const period = Math.floor(toNumber(evalScalarAt(args[0]!, ctx, barIdx)) ?? 0);
    const width = Math.floor(toNumber(evalScalarAt(args[1]!, ctx, barIdx)) ?? 2);
    if (period < 1) return null;
    const cNode: AstNode = { kind: "variable", name: "C", lookback: null };
    return bollingerAt(cNode, ctx, barIdx, period, width, name === "BBTOP" ? "top" : "bot");
  }

  const FUNDAMENTAL_FUNCS = new Set([
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
  if (FUNDAMENTAL_FUNCS.has(name.toUpperCase())) {
    return evalFundamentalCall(node, ctx, 0, barIdx, evalScalarAt);
  }

  // Rolling / series functions with expression first argument
  if (args.length >= 2) {
    const period = Math.floor(numArgs[1] ?? 0);
    if (period < 1 || period > MAX_LOOKBACK) return null;
    const first = args[0]!;
    if (
      first.kind === "variable" &&
      first.lookback === null &&
      isBareFundamentalIdentifier(first.name) &&
      (name === "MA" ||
        name === "EMA" ||
        name === "WMA" ||
        name === "SUM" ||
        name === "HHV" ||
        name === "LLV" ||
        name === "STDEV" ||
        name === "STDDEV" ||
        name === "ROC")
    ) {
      return null;
    }

    if (name === "MA") {
      let s = 0;
      for (let i = 0; i < period; i++) {
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        s += v;
      }
      return s / period;
    }

    if (name === "EMA") {
      const vals: number[] = [];
      for (let i = 0; i < period; i++) {
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        vals.push(v);
      }
      const k = 2 / (period + 1);
      let ema = vals.reduce((a, b) => a + b, 0) / period;
      for (let i = period - 2; i >= 0; i--) {
        ema = vals[i]! * k + ema * (1 - k);
      }
      return ema;
    }

    if (name === "WMA") {
      let num = 0;
      let den = 0;
      for (let i = 0; i < period; i++) {
        const w = period - i;
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        num += w * v;
        den += w;
      }
      return den === 0 ? null : num / den;
    }

    if (name === "SUM") {
      let s = 0;
      for (let i = 0; i < period; i++) {
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        s += v;
      }
      return s;
    }

    if (name === "HHV") {
      let mx: number | null = null;
      for (let i = 0; i < period; i++) {
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        mx = mx === null ? v : Math.max(mx, v);
      }
      return mx;
    }

    if (name === "LLV") {
      let mn: number | null = null;
      for (let i = 0; i < period; i++) {
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        mn = mn === null ? v : Math.min(mn, v);
      }
      return mn;
    }

    if (name === "STDEV" || name === "STDDEV") {
      const vals: number[] = [];
      for (let i = 0; i < period; i++) {
        const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
        if (v === null) return null;
        vals.push(v);
      }
      const mean = vals.reduce((a, b) => a + b, 0) / period;
      let s2 = 0;
      for (const v of vals) s2 += (v - mean) ** 2;
      return Math.sqrt(s2 / period);
    }

    if (name === "ROC") {
      if (barIdx + period >= ctx.bars.length) return null;
      const cur = toNumber(evalScalarAt(first, ctx, barIdx));
      const past = toNumber(evalScalarAt(first, ctx, barIdx + period));
      if (cur === null || past === null || past === 0) return null;
      return ((cur - past) / past) * 100;
    }
  }

  return null;
}

function bollingerAt(
  first: AstNode,
  ctx: EvalContext,
  barIdx: number,
  period: number,
  width: number,
  part: "top" | "bot"
): number | null {
  const vals: number[] = [];
  for (let i = 0; i < period; i++) {
    const v = toNumber(evalScalarAt(first, ctx, barIdx + i));
    if (v === null) return null;
    vals.push(v);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / period;
  let s2 = 0;
  for (const v of vals) s2 += (v - mean) ** 2;
  const sd = Math.sqrt(s2 / period);
  return part === "top" ? mean + width * sd : mean - width * sd;
}

function atrWilderSlice(bars: Bar[], barIdx: number, period: number): number | null {
  const tr: number[] = [];
  for (let i = barIdx; i < bars.length - 1; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i + 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (tr.length < period) return null;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]!) / period;
  }
  return atr;
}

function vwapFrom(bars: Bar[], barIdx: number): number | null {
  let pv = 0;
  let vol = 0;
  for (let i = barIdx; i < bars.length; i++) {
    const b = bars[i]!;
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    vol += b.volume;
  }
  return vol === 0 ? null : pv / vol;
}

function rsiAt(bars: Bar[], barIdx: number, period: number): number | null {
  if (period < 1 || barIdx + period >= bars.length) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    const c0 = bars[barIdx + i]!.close;
    const c1 = bars[barIdx + i + 1]!.close;
    const ch = c0 - c1;
    if (ch > 0) gains += ch;
    else losses -= ch;
  }
  const ag = gains / period;
  const al = losses / period;
  if (al === 0) return 100;
  const rs = ag / al;
  return 100 - 100 / (1 + rs);
}

function evalNode(node: AstNode, ctx: EvalContext): number | null {
  return toNumber(evalScalarAt(node, ctx, 0));
}

export function evaluateScript(ast: ScriptAst, ctx: EvalContext): boolean {
  ctx.variables = { ...ctx.variables };
  for (const { name, expr } of ast.assignments) {
    const v = evalNode(expr, ctx);
    if (v === null) return false;
    ctx.variables[name] = v;
  }
  const result = evalScalarAt(ast.filter, ctx, 0);
  if (result === null) return false;
  if (typeof result === "string") return result !== "";
  return result !== 0;
}

export function evaluateExpression(node: AstNode, ctx: EvalContext): number | null {
  return evalNode(node, ctx);
}

export function evaluateExpressionAt(node: AstNode, ctx: EvalContext, barIdx: number): number | null {
  return toNumber(evalScalarAt(node, ctx, barIdx));
}
