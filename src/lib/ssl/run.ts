/**
 * Run SSL over a list of symbols; returns symbols that pass, optional sort/limit, and column values.
 */

import { parseScript } from "./parser";
import { ParseError } from "./parser";
import { evaluateScript, evaluateExpression, type EvalContext } from "./interpreter";
import { getBarsForSymbol } from "./get-bars";
import { getSnapshotForSymbol } from "./get-bars";
import { getFinancialSeriesForSsl } from "@/lib/screener-db-native";
import { collectDisplayExpressions } from "./display-expressions";
import type { ScriptColumnDisplayEntry } from "./display-expressions";
import type { ScriptAst } from "./ast";

const DEFAULT_BAR_LIMIT = 300;

export type RunSslResult = {
  passingSymbols: string[];
  scriptColumns: string[];
  scriptColumnDisplay: ScriptColumnDisplayEntry[];
  scriptValues: Record<string, Record<string, number>>;
  error?: string;
};

function applyResultShaping(
  ast: ScriptAst,
  passed: Array<{ symbol: string; ctx: EvalContext }>
): string[] {
  const rs = ast.resultShaping;
  if (!rs || passed.length === 0) return passed.map((p) => p.symbol);

  const score = (sym: string, ctx: EvalContext, node: import("./ast").AstNode): number | null => {
    const v = evaluateExpression(node, ctx);
    return v;
  };

  if (rs.kind === "topn") {
    const rows = passed
      .map((p) => ({
        symbol: p.symbol,
        v: score(p.symbol, p.ctx, rs.expr),
      }))
      .filter((r) => r.v !== null && Number.isFinite(r.v as number)) as Array<{ symbol: string; v: number }>;
    rows.sort((a, b) => b.v - a.v);
    return rows.slice(0, rs.n).map((r) => r.symbol);
  }

  if (rs.kind === "bottomn") {
    const rows = passed
      .map((p) => ({
        symbol: p.symbol,
        v: score(p.symbol, p.ctx, rs.expr),
      }))
      .filter((r) => r.v !== null && Number.isFinite(r.v as number)) as Array<{ symbol: string; v: number }>;
    rows.sort((a, b) => a.v - b.v);
    return rows.slice(0, rs.n).map((r) => r.symbol);
  }

  if (rs.kind === "sort_limit") {
    if (!rs.sortExpr) {
      let syms = passed.map((p) => p.symbol);
      if (rs.limit != null && rs.limit > 0) syms = syms.slice(0, rs.limit);
      return syms;
    }
    let rows = passed.map((p) => ({
      symbol: p.symbol,
      v: score(p.symbol, p.ctx, rs.sortExpr!),
    }));
    rows = rows.filter((r) => r.v !== null && Number.isFinite(r.v as number)) as Array<{
      symbol: string;
      v: number;
    }>;
    rows.sort((a, b) => (rs.asc ? (a.v as number) - (b.v as number) : (b.v as number) - (a.v as number)));
    let syms = rows.map((r) => r.symbol);
    if (rs.limit != null && rs.limit > 0) syms = syms.slice(0, rs.limit);
    return syms;
  }

  return passed.map((p) => p.symbol);
}

export async function runSslScript(
  script: string,
  symbols: string[],
  asOfDate: string,
  options?: { barLimit?: number }
): Promise<RunSslResult> {
  const barLimit = options?.barLimit ?? DEFAULT_BAR_LIMIT;
  let ast: ScriptAst;
  try {
    ast = parseScript(script.trim());
  } catch (e) {
    const msg = e instanceof ParseError ? e.message : e instanceof Error ? e.message : "Parse error";
    return { passingSymbols: [], scriptColumns: [], scriptColumnDisplay: [], scriptValues: {}, error: msg };
  }

  const displayExpressions = collectDisplayExpressions(ast);
  const scriptColumns = displayExpressions.map((e) => e.key);
  const scriptColumnDisplay: ScriptColumnDisplayEntry[] = displayExpressions.map((e) => ({
    key: e.key,
    header: e.header,
    ...(e.format ? { format: e.format } : {}),
  }));
  const passed: Array<{ symbol: string; ctx: EvalContext }> = [];

  for (const symbol of symbols) {
    try {
      const bars = await getBarsForSymbol(symbol, asOfDate, barLimit);
      if (bars.length === 0) continue;
      const snapshot = getSnapshotForSymbol(symbol, asOfDate);
      const fundamentals = getFinancialSeriesForSsl(symbol, asOfDate);
      const ctx: EvalContext = {
        bars,
        variables: {},
        snapshot: snapshot ?? undefined,
        symbol,
        fundamentals,
      };
      const pass = evaluateScript(ast, ctx);
      if (!pass) continue;
      passed.push({ symbol, ctx });
    } catch {
      // Skip symbol on runtime error
    }
  }

  const orderedSymbols = applyResultShaping(ast, passed);

  const scriptValues: Record<string, Record<string, number>> = {};
  const ctxBySym = new Map(passed.map((p) => [p.symbol, p.ctx]));

  for (const symbol of orderedSymbols) {
    const ctx = ctxBySym.get(symbol);
    if (!ctx) continue;
    const row: Record<string, number> = {};
    for (const { key, node } of displayExpressions) {
      const v = evaluateExpression(node, ctx);
      if (v !== null && Number.isFinite(v)) row[key] = v;
    }
    scriptValues[symbol] = row;
  }

  return { passingSymbols: orderedSymbols, scriptColumns, scriptColumnDisplay, scriptValues };
}

/** @deprecated Use runSslScript */
export const runNinoScript = runSslScript;
export type RunNinoScriptResult = RunSslResult;
