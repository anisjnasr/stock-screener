/**
 * Run Nino Script over a list of symbols; returns symbols that pass and per-symbol script column values.
 */

import { parseScript } from "./parser";
import { ParseError } from "./parser";
import { evaluateScript, evaluateExpression } from "./interpreter";
import { getBarsForSymbol } from "./get-bars";
import { collectDisplayExpressions } from "./display-expressions";

const DEFAULT_BAR_LIMIT = 300;

export type RunNinoScriptResult = {
  passingSymbols: string[];
  scriptColumns: string[];
  scriptValues: Record<string, Record<string, number>>;
  error?: string;
};

export async function runNinoScript(
  script: string,
  symbols: string[],
  asOfDate: string,
  options?: { barLimit?: number }
): Promise<RunNinoScriptResult> {
  const barLimit = options?.barLimit ?? DEFAULT_BAR_LIMIT;
  let ast;
  try {
    ast = parseScript(script.trim());
  } catch (e) {
    const msg = e instanceof ParseError ? e.message : e instanceof Error ? e.message : "Parse error";
    return { passingSymbols: [], scriptColumns: [], scriptValues: {}, error: msg };
  }

  const displayExpressions = collectDisplayExpressions(ast);
  const scriptColumns = displayExpressions.map((e) => e.label);
  const passingSymbols: string[] = [];
  const scriptValues: Record<string, Record<string, number>> = {};

  for (const symbol of symbols) {
    try {
      const bars = await getBarsForSymbol(symbol, asOfDate, barLimit);
      if (bars.length === 0) continue;
      const ctx = { bars, variables: {} };
      const pass = evaluateScript(ast, ctx);
      if (!pass) continue;
      passingSymbols.push(symbol);
      const row: Record<string, number> = {};
      for (const { label, node } of displayExpressions) {
        const v = evaluateExpression(node, ctx);
        if (v !== null && Number.isFinite(v)) row[label] = v;
      }
      scriptValues[symbol] = row;
    } catch {
      // Skip symbol on any runtime error (e.g. insufficient data)
    }
  }
  return { passingSymbols, scriptColumns, scriptValues };
}
