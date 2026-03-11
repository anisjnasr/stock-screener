/**
 * Interpreter for Nino Script. Evaluates AST with bars (newest-first) and variables.
 */

import type { AstNode, ScriptAst } from "./ast";

export type Bar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type EvalContext = {
  bars: Bar[];
  variables: Record<string, number>;
};

const PRICE_VOLUME = new Set(["P", "C", "O", "H", "L", "V"]);
const SERIES_KEYS: Record<string, keyof Bar> = {
  P: "close",
  C: "close",
  O: "open",
  H: "high",
  L: "low",
  V: "volume",
};

const MAX_LOOKBACK = 500;

function getSeriesValue(bars: Bar[], barIndex: number, name: string): number | null {
  if (barIndex < 0 || barIndex >= bars.length) return null;
  const key = SERIES_KEYS[name];
  if (!key) return null;
  const v = bars[barIndex]![key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function evalNode(node: AstNode, ctx: EvalContext): number | null {
  switch (node.kind) {
    case "number":
      return node.value;
    case "variable": {
      let index = 0;
      if (node.lookback !== null) {
        const n = evalNode(node.lookback, ctx);
        if (n === null || n < 0 || !Number.isInteger(n) || n > MAX_LOOKBACK) return null;
        index = n;
      }
      if (PRICE_VOLUME.has(node.name)) {
        return getSeriesValue(ctx.bars, index, node.name);
      }
      const v = ctx.variables[node.name];
      return v !== undefined && typeof v === "number" ? v : null;
    }
    case "binary": {
      if (node.op === "AND" || node.op === "OR") {
        const a = evalNode(node.left, ctx);
        const b = evalNode(node.right, ctx);
        const ba = a !== null && a !== 0;
        const bb = b !== null && b !== 0;
        if (node.op === "AND") return ba && bb ? 1 : 0;
        return ba || bb ? 1 : 0;
      }
      const left = evalNode(node.left, ctx);
      const right = evalNode(node.right, ctx);
      if (left === null || right === null) return null;
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right === 0 ? null : left / right;
        case "^":
          return left ** right;
        case ">":
          return left > right ? 1 : 0;
        case "<":
          return left < right ? 1 : 0;
        case ">=":
          return left >= right ? 1 : 0;
        case "<=":
          return left <= right ? 1 : 0;
        case "=":
          return left === right ? 1 : 0;
        case "<>":
          return left !== right ? 1 : 0;
        default:
          return null;
      }
    }
    case "unary": {
      const operand = evalNode(node.operand, ctx);
      if (operand === null) return null;
      if (node.op === "NOT") return operand !== 0 ? 0 : 1;
      if (node.op === "-") return -operand;
      return null;
    }
    case "call": {
      const name = node.name;
      const args = node.args.map((a) => evalNode(a, ctx));
      if (args.some((a) => a === null)) return null;
      const numArgs = args as number[];

      if (name === "ABS") {
        return numArgs.length >= 1 ? Math.abs(numArgs[0]!) : null;
      }

      const bars = ctx.bars;
      const n = numArgs.length >= 2 ? Math.floor(numArgs[1]!) : (numArgs[0] ? Math.floor(numArgs[0]) : 0);
      if (n < 1 || n > MAX_LOOKBACK || n > bars.length) return null;

      if (name === "ATR") {
        const period = Math.floor(numArgs[0]!);
        if (period < 1 || bars.length < period + 1) return null;
        const tr: number[] = [];
        for (let i = 0; i < bars.length - 1; i++) {
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

      if (name === "RVOL") {
        const period = Math.floor(numArgs[0]!);
        if (period < 1 || bars.length < period) return null;
        const v = bars[0]!.volume;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += bars[i]!.volume;
        const avg = sum / period;
        return avg === 0 ? null : v / avg;
      }

      if (name === "ATRP") {
        const period = Math.floor(numArgs[0]!);
        if (period < 1 || bars.length < period + 1) return null;
        const tr: number[] = [];
        for (let i = 0; i < bars.length - 1; i++) {
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
        const close = bars[0]!.close;
        return close === 0 ? null : atr / close;
      }

      const seriesArg = node.args[0];
      if (!seriesArg || seriesArg.kind !== "variable") return null;
      const seriesName = seriesArg.name;
      if (!PRICE_VOLUME.has(seriesName)) return null;
      const offset = numArgs.length >= 3 ? Math.floor(numArgs[2]!) : 0;
      if (offset < 0 || offset + n > bars.length) return null;

      const seriesValues: number[] = [];
      for (let i = 0; i < n; i++) {
        const val = getSeriesValue(bars, offset + i, seriesName);
        if (val === null) return null;
        seriesValues.push(val);
      }

      switch (name) {
        case "MA": {
          const sum = seriesValues.reduce((a, b) => a + b, 0);
          return sum / n;
        }
        case "EMA": {
          const k = 2 / (n + 1);
          let ema = seriesValues.reduce((a, b) => a + b, 0) / n;
          for (let i = n - 2; i >= 0; i--) {
            ema = seriesValues[i]! * k + ema * (1 - k);
          }
          return ema;
        }
        case "SUM":
          return seriesValues.reduce((a, b) => a + b, 0);
        case "MAX":
          return Math.max(...seriesValues);
        case "MIN":
          return Math.min(...seriesValues);
        case "ROC": {
          if (offset + n >= bars.length) return null;
          const current = getSeriesValue(bars, offset, seriesName);
          const past = getSeriesValue(bars, offset + n, seriesName);
          if (current === null || past === null || past === 0) return null;
          return ((current - past) / past) * 100;
        }
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

export function evaluateScript(ast: ScriptAst, ctx: EvalContext): boolean {
  ctx.variables = { ...ctx.variables };
  for (const { name, expr } of ast.assignments) {
    const v = evalNode(expr, ctx);
    if (v === null) return false;
    ctx.variables[name] = v;
  }
  const result = evalNode(ast.expression, ctx);
  if (result === null) return false;
  return result !== 0;
}

export function evaluateExpression(node: AstNode, ctx: EvalContext): number | null {
  return evalNode(node, ctx);
}
