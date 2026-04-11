/**
 * Derive result column keys, display headers, formats, and evaluation nodes from an SSL script AST.
 */

import type { AstNode, ScriptAst } from "./ast";

export function astToString(node: AstNode): string {
  switch (node.kind) {
    case "number":
      return String(node.value);
    case "string":
      return `"${node.value}"`;
    case "variable": {
      const n = node.name;
      if (node.lookback !== null) {
        const lb = astToString(node.lookback);
        return lb ? `${n}[${lb}]` : n;
      }
      return n;
    }
    case "binary": {
      const ops = ["AND", "OR", "+", "-", "*", "/", "%", "^", ">", "<", ">=", "<=", "==", "!=", "<>"];
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
    case "lookback": {
      const target = astToString(node.target);
      const offset = astToString(node.offset);
      return `${target}[${offset}]`;
    }
    default:
      return "";
  }
}

const COMPARISON_OPS = new Set([">", "<", ">=", "<=", "==", "!=", "<>"]);

function collectFromExpression(expr: AstNode): Array<{ key: string; node: AstNode }> {
  if (expr.kind === "binary") {
    if (COMPARISON_OPS.has(expr.op)) {
      const out: Array<{ key: string; node: AstNode }> = [];
      if (expr.left.kind !== "number") {
        const key = astToString(expr.left);
        if (key) out.push({ key, node: expr.left });
      }
      if (expr.right.kind !== "number") {
        const key = astToString(expr.right);
        if (key) out.push({ key, node: expr.right });
      }
      return out;
    }
    if (expr.op === "AND" || expr.op === "OR") {
      return [...collectFromExpression(expr.left), ...collectFromExpression(expr.right)];
    }
  }
  return [];
}

function isCloseSeries(node: AstNode): boolean {
  return node.kind === "variable" && (node.name === "C" || node.name === "CLOSE" || node.name === "P");
}

/** Humanize assignment variable for table header (e.g. GAIN_1M -> Gain 1M; RVOL stays RVOL). */
export function humanizeVarName(name: string): string {
  if (!name.includes("_")) {
    if (name.length > 0 && name === name.toUpperCase() && name.length <= 5 && /^[A-Z0-9]+$/.test(name)) {
      return name;
    }
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (/^\d+[a-zA-Z]?$/.test(part)) return part.replace(/m$/i, "M").replace(/w$/i, "W").replace(/y$/i, "Y");
      if (part.length === 0) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Short table header from an expression AST (spec §12.2). */
export function astToColumnHeader(node: AstNode): string {
  if (node.kind === "lookback") {
    return `${astToColumnHeader(node.target)}[${astToString(node.offset)}]`;
  }
  if (node.kind === "call") {
    const fn = node.name;
    const args = node.args;
    if (fn === "MA" && args.length >= 2 && args[0].kind === "variable") {
      const series = args[0].name;
      const rest = args.slice(1).map(astToString).join(", ");
      if (series === "V" || series === "H" || series === "L" || series === "O") {
        return `MA ${series}(${rest})`;
      }
      if (isCloseSeries(args[0])) {
        return `MA(${rest})`;
      }
    }
    if (fn === "HHV" && args.length >= 2 && args[0].kind === "variable" && args[0].name === "H") {
      const rest = args.slice(1).map(astToString).join(", ");
      return `HHV H(${rest})`;
    }
    if (fn === "LLV" && args.length >= 2 && args[0].kind === "variable" && args[0].name === "L") {
      const rest = args.slice(1).map(astToString).join(", ");
      return `LLV L(${rest})`;
    }
    if (args.length > 0 && isCloseSeries(args[0])) {
      const rest = args.slice(1).map(astToString).join(", ");
      return rest.length > 0 ? `${fn}(${rest})` : `${fn}()`;
    }
    return `${fn}(${args.map(astToString).join(", ")})`;
  }
  if (node.kind === "binary" && node.op === "/") {
    return `${astToColumnHeader(node.left)}/${astToColumnHeader(node.right)}`;
  }
  return astToString(node);
}

export type ScriptColumnFormat = "pct" | "int" | "float";

function callName(node: AstNode): string | null {
  return node.kind === "call" ? node.name.toUpperCase() : null;
}

/** Infer cell format from the evaluated expression. */
export function inferFormat(node: AstNode): ScriptColumnFormat | undefined {
  if (node.kind === "lookback") return inferFormat(node.target);
  if (node.kind === "call") {
    const n = callName(node);
    if (n === "ATRP" || n === "ROC") return "pct";
    if (n === "RS" || n === "INDRANK") return "int";
    if (n === "MA" && node.args[0]?.kind === "variable" && node.args[0].name === "V") return "int";
    return "float";
  }
  if (node.kind === "binary" && (node.op === "/" || node.op === "*" || node.op === "+" || node.op === "-")) {
    return "float";
  }
  if (node.kind === "variable") {
    const u = node.name.toUpperCase();
    if (u === "MARKET_CAP" || u === "MC") return "int";
  }
  return "float";
}

export type DisplayExpression = {
  key: string;
  header: string;
  node: AstNode;
  format?: ScriptColumnFormat;
};

/** Serialized on `/api/screener` next to `scriptColumns` for UI headers and formatting. */
export type ScriptColumnDisplayEntry = {
  key: string;
  header: string;
  format?: ScriptColumnFormat;
};

const REDUNDANT_PRICE = new Set(["P", "C", "CLOSE"]);

export function collectDisplayExpressions(ast: ScriptAst): DisplayExpression[] {
  const seen = new Set<string>();
  const out: DisplayExpression[] = [];

  const push = (key: string, header: string, node: AstNode) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const format = inferFormat(node);
    out.push({ key, header, node, format });
  };

  for (const { key, node } of collectFromExpression(ast.filter)) {
    if (REDUNDANT_PRICE.has(key)) continue;
    const header = astToColumnHeader(node);
    push(key, header, node);
  }

  for (const { name, expr } of ast.assignments) {
    if (expr.kind === "number") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const format = inferFormat(expr);
    out.push({ key: name, header: humanizeVarName(name), node: expr, format });
  }

  const rs = ast.resultShaping;
  if (rs) {
    if (rs.kind === "topn" || rs.kind === "bottomn") {
      const key = astToString(rs.expr);
      if (key && !seen.has(key)) {
        seen.add(key);
        const format = inferFormat(rs.expr);
        out.push({ key, header: astToColumnHeader(rs.expr), node: rs.expr, format });
      }
    } else if (rs.sortExpr) {
      const key = astToString(rs.sortExpr);
      if (key && !seen.has(key)) {
        seen.add(key);
        const format = inferFormat(rs.sortExpr);
        out.push({ key, header: astToColumnHeader(rs.sortExpr), node: rs.sortExpr, format });
      }
    }
  }

  return out;
}
