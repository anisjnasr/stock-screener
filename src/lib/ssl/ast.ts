/**
 * AST for StockStalker Scan Language (SSL).
 */

export type AstNode =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "variable"; name: string; lookback: AstNode | null }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "unary"; op: string; operand: AstNode }
  | { kind: "call"; name: string; args: AstNode[] }
  | { kind: "lookback"; target: AstNode; offset: AstNode };

export type ResultShaping =
  | { kind: "topn"; expr: AstNode; n: number }
  | { kind: "bottomn"; expr: AstNode; n: number }
  | { kind: "sort_limit"; sortExpr: AstNode | null; asc: boolean; limit: number | null };

export type ScriptAst = {
  assignments: Array<{ name: string; expr: AstNode }>;
  /** Combined filter (AND of all non-assignment expression statements). */
  filter: AstNode;
  resultShaping: ResultShaping | null;
};
