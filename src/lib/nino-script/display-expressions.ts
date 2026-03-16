/**
 * Turn AST nodes into short display labels and collect display expressions from a script.
 */

import type { AstNode, ScriptAst } from "./ast";

export function astToString(node: AstNode): string {
  switch (node.kind) {
    case "number":
      return String(node.value);
    case "variable": {
      const n = node.name;
      if (node.lookback !== null) {
        const lb = astToString(node.lookback);
        return lb ? `${n}[${lb}]` : n;
      }
      return n;
    }
    case "binary": {
      const ops = ["AND", "OR", "+", "-", "*", "/", "^", ">", "<", ">=", "<=", "=", "<>"];
      if (ops.includes(node.op)) {
        const left = astToString(node.left);
        const right = astToString(node.right);
        return `(${left} ${node.op} ${right})`;
      }
      return "";
    }
    case "unary":
      return `${node.op}(${astToString(node.operand)})`;
    case "call": {
      const args = node.args.map(astToString).join(", ");
      return `${node.name}(${args})`;
    }
    default:
      return "";
  }
}

const COMPARISON_OPS = new Set([">", "<", ">=", "<=", "=", "<>"]);

function collectFromExpression(expr: AstNode): Array<{ label: string; node: AstNode }> {
  if (expr.kind === "binary") {
    if (COMPARISON_OPS.has(expr.op)) {
      const out: Array<{ label: string; node: AstNode }> = [];
      if (expr.left.kind !== "number") {
        const label = astToString(expr.left);
        if (label) out.push({ label, node: expr.left });
      }
      if (expr.right.kind !== "number") {
        const label = astToString(expr.right);
        if (label) out.push({ label, node: expr.right });
      }
      return out;
    }
    if (expr.op === "AND" || expr.op === "OR") {
      return [...collectFromExpression(expr.left), ...collectFromExpression(expr.right)];
    }
  }
  return [];
}

export type DisplayExpression = { label: string; node: AstNode };

/**
 * Collect display expressions: assignment names (with their expr) and both sides of
 * comparisons in the main expression. Deduped by label (first wins).
 */
export function collectDisplayExpressions(ast: ScriptAst): DisplayExpression[] {
  const seen = new Set<string>();
  const out: DisplayExpression[] = [];

  for (const { name, expr } of ast.assignments) {
    if (expr.kind === "number") continue;
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ label: name, node: expr });
    }
  }

  const REDUNDANT_WITH_LAST_PRICE = new Set(["P", "C"]);
  for (const { label, node } of collectFromExpression(ast.expression)) {
    if (!label || seen.has(label) || REDUNDANT_WITH_LAST_PRICE.has(label)) continue;
    seen.add(label);
    out.push({ label, node });
  }

  return out;
}
