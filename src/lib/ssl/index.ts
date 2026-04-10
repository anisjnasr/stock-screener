/**
 * StockStalker Scan Language (SSL): parse, evaluate, and run scripts over daily bars.
 */

export { parseScript, ParseError, SSL_RESERVED_IDENTIFIERS } from "./parser";
export type { ScriptAst, AstNode, ResultShaping } from "./ast";
export { evaluateScript, evaluateExpression, evalScalarAt, evaluateExpressionAt } from "./interpreter";
export type { Bar, EvalContext, SnapshotData } from "./interpreter";
export { getBarsForSymbol, getSnapshotForSymbol } from "./get-bars";
export { runSslScript, runNinoScript } from "./run";
export type { RunSslResult, RunNinoScriptResult } from "./run";
export {
  astToString,
  collectDisplayExpressions,
  humanizeVarName,
  astToColumnHeader,
  inferFormat,
} from "./display-expressions";
export type {
  DisplayExpression,
  ScriptColumnFormat,
  ScriptColumnDisplayEntry,
} from "./display-expressions";
