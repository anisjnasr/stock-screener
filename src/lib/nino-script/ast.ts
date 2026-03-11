/**
 * AST node types for Nino Script.
 */

export type AstNode =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string; lookback: AstNode | null }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "unary"; op: string; operand: AstNode }
  | { kind: "call"; name: string; args: AstNode[] };

export type ScriptAst = {
  assignments: Array<{ name: string; expr: AstNode }>;
  expression: AstNode;
};
