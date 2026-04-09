/**
 * Recursive-descent parser for SSL (StockStalker Scan Language).
 */

import { lex } from "./lexer";
import type { Token } from "./lexer";
import type { AstNode, ResultShaping, ScriptAst } from "./ast";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/** Reserved identifiers — cannot be used as user variable names (SSL §9). */
export const SSL_RESERVED_IDENTIFIERS = new Set(
  [
    "OPEN",
    "O",
    "HIGH",
    "H",
    "LOW",
    "L",
    "CLOSE",
    "C",
    "VOLUME",
    "V",
    "IPO_DATE",
    "MARKET_CAP",
    "SECTOR",
    "INDUSTRY",
    "NAME",
    "ADV",
    "DAYS_SINCE_IPO",
    "SHARES_OUT",
    "FLOAT",
    "SHORT_INT",
    "RS",
    "INDRANK",
    "INDRS",
    "EPS_GROWTH_QOQ",
    "EPS_GROWTH_YOY",
    "REV_GROWTH_QOQ",
    "REV_GROWTH_YOY",
    "EPS",
    "REVENUE",
    "EPS_SURPRISE",
    "EPS_ANNUAL",
    "REV_ANNUAL",
    "EPS_GROWTH_ANNUAL",
    "REV_GROWTH_ANNUAL",
    "AND",
    "OR",
    "NOT",
    "TOPN",
    "BOTTOMN",
    "SORT_BY",
    "LIMIT",
    "ASC",
    "MA",
    "EMA",
    "WMA",
    "HHV",
    "LLV",
    "SUM",
    "STDEV",
    "ATR",
    "ATRP",
    "VWAP",
    "BBTOP",
    "BBBOT",
    "ROC",
    "CROSS",
    "CROSSBELOW",
    "BARSSINCE",
    "ABS",
    "MAX",
    "MIN",
    "SQRT",
    "LOG",
    "ROUND",
    "IIF",
    "REF",
    "TODAY",
    "DATEDIFF",
    "TRADINGDAYSSINCE",
    "DAYOFWEEK",
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
    "RSI",
  ].map((s) => s.toUpperCase())
);

type Stmt =
  | { kind: "assign"; name: string; expr: AstNode }
  | { kind: "filter"; expr: AstNode }
  | { kind: "sort_by"; expr: AstNode; asc: boolean }
  | { kind: "limit"; expr: AstNode }
  | { kind: "topn"; expr: AstNode; n: AstNode }
  | { kind: "bottomn"; expr: AstNode; n: AstNode };

export function parseScript(source: string): ScriptAst {
  let tokens: ReturnType<typeof lex>;
  try {
    tokens = lex(source.trim());
  } catch (e) {
    throw new ParseError(e instanceof Error ? e.message : "Invalid character in SSL script");
  }
  let pos = 0;

  function cur(): Token {
    return tokens[pos]!;
  }
  function advance(): Token {
    const t = cur();
    if (t.type !== "eof") pos++;
    return t;
  }
  function is(...types: Token["type"][]): boolean {
    return types.includes(cur().type);
  }
  function expect(type: Token["type"], msg?: string): Token {
    const t = cur();
    if (t.type !== type) {
      throw new ParseError(msg ?? `Expected ${type}, got ${t.type}`);
    }
    return advance();
  }

  function tokenValue(t: Token): string {
    return "value" in t ? (t as { value: string }).value : "";
  }

  function eof(): boolean {
    return cur().type === "eof";
  }

  const stmts: Stmt[] = [];

  while (!eof()) {
    if (is("keyword") && tokenValue(cur()) === "SORT_BY") {
      advance();
      if (!is("op") || tokenValue(cur()) !== "=") throw new ParseError('Expected "=" after SORT_BY');
      advance();
      const expr = parseExpression();
      let asc = false;
      if (is("keyword") && tokenValue(cur()) === "ASC") {
        advance();
        asc = true;
      }
      expect(";", "Missing semicolon after SORT_BY statement");
      stmts.push({ kind: "sort_by", expr, asc });
      continue;
    }

    if (is("keyword") && tokenValue(cur()) === "LIMIT") {
      advance();
      if (!is("op") || tokenValue(cur()) !== "=") throw new ParseError('Expected "=" after LIMIT');
      advance();
      const expr = parseExpression();
      expect(";", "Missing semicolon after LIMIT statement");
      stmts.push({ kind: "limit", expr });
      continue;
    }

    if (is("id")) {
      const next = tokens[pos + 1];
      if (next && next.type === "op" && tokenValue(next) === "=") {
        const name = tokenValue(cur());
        if (SSL_RESERVED_IDENTIFIERS.has(name)) {
          throw new ParseError(`"${name}" is reserved and cannot be used as a variable name`);
        }
        advance();
        advance();
        const expr = parseExpression();
        expect(";", "Missing semicolon at end of statement");
        stmts.push({ kind: "assign", name, expr });
        continue;
      }
    }

    const expr = parseExpression();
    if (
      expr.kind === "call" &&
      (expr.name === "TOPN" || expr.name === "BOTTOMN")
    ) {
      if (expr.args.length !== 2) {
        throw new ParseError(`${expr.name}() requires 2 arguments (expression, count)`);
      }
      expect(";", "Missing semicolon after result-shaping statement");
      if (expr.name === "TOPN") stmts.push({ kind: "topn", expr: expr.args[0]!, n: expr.args[1]! });
      else stmts.push({ kind: "bottomn", expr: expr.args[0]!, n: expr.args[1]! });
      continue;
    }

    expect(";", "Missing semicolon at end of statement");
    stmts.push({ kind: "filter", expr });
  }

  validateResultShapingOrder(stmts);

  const assignments: Array<{ name: string; expr: AstNode }> = [];
  const filters: AstNode[] = [];
  let sortBy: { expr: AstNode; asc: boolean } | null = null;
  let limitExpr: AstNode | null = null;
  let topOrBottom: { kind: "topn" | "bottomn"; expr: AstNode; n: AstNode } | null = null;

  let seenResult = false;
  for (const s of stmts) {
    if (s.kind === "assign") {
      if (seenResult) throw new ParseError("Variable assignments must appear before result shaping (TopN, SORT_BY, …)");
      assignments.push({ name: s.name, expr: s.expr });
    } else if (s.kind === "filter") {
      if (seenResult) throw new ParseError("Filter conditions must appear before result shaping");
      filters.push(s.expr);
    } else {
      seenResult = true;
      if (s.kind === "sort_by") {
        if (sortBy || topOrBottom) throw new ParseError("Only one result-shaping method allowed (TopN/BottomN or SORT_BY/LIMIT)");
        sortBy = { expr: s.expr, asc: s.asc };
      } else if (s.kind === "limit") {
        if (topOrBottom) throw new ParseError("LIMIT cannot be combined with TopN/BottomN");
        if (limitExpr) throw new ParseError("Duplicate LIMIT");
        limitExpr = s.expr;
      } else if (s.kind === "topn") {
        if (sortBy || limitExpr) throw new ParseError("Use TopN/BottomN or SORT_BY/LIMIT, not both");
        topOrBottom = { kind: "topn", expr: s.expr, n: s.n };
      } else if (s.kind === "bottomn") {
        if (sortBy || limitExpr) throw new ParseError("Use TopN/BottomN or SORT_BY/LIMIT, not both");
        topOrBottom = { kind: "bottomn", expr: s.expr, n: s.n };
      }
    }
  }

  if (filters.length === 0) {
    throw new ParseError("Script must include at least one filter condition");
  }

  let filter: AstNode = filters[0]!;
  for (let i = 1; i < filters.length; i++) {
    filter = { kind: "binary", op: "AND", left: filter, right: filters[i]! };
  }

  let resultShaping: ResultShaping | null = null;
  if (topOrBottom) {
    resultShaping =
      topOrBottom.kind === "topn"
        ? { kind: "topn", expr: topOrBottom.expr, n: evalLiteralCount(topOrBottom.n, "TopN") }
        : { kind: "bottomn", expr: topOrBottom.expr, n: evalLiteralCount(topOrBottom.n, "BottomN") };
  } else if (sortBy || limitExpr) {
    resultShaping = {
      kind: "sort_limit",
      sortExpr: sortBy?.expr ?? null,
      asc: sortBy?.asc ?? false,
      limit: limitExpr ? evalLiteralCount(limitExpr, "LIMIT") : null,
    };
  }

  function evalLiteralCount(node: AstNode, ctx: string): number {
    if (node.kind !== "number" || !Number.isInteger(node.value) || node.value < 1) {
      throw new ParseError(`${ctx} requires a positive integer literal for the count`);
    }
    return node.value;
  }

  function validateResultShapingOrder(st: Stmt[]): void {
    let rs = false;
    for (const s of st) {
      const isRs =
        s.kind === "sort_by" || s.kind === "limit" || s.kind === "topn" || s.kind === "bottomn";
      if (isRs) rs = true;
      else if (rs && (s.kind === "assign" || s.kind === "filter")) {
        throw new ParseError("Result shaping (TopN/BottomN/SORT_BY/LIMIT) must be the last statement(s) in the script");
      }
    }
  }

  function parseExpression(): AstNode {
    return parseOr();
  }

  function parseOr(): AstNode {
    let left = parseAnd();
    while (is("keyword") && tokenValue(cur()) === "OR") {
      advance();
      const right = parseAnd();
      left = { kind: "binary", op: "OR", left, right };
    }
    return left;
  }

  function parseAnd(): AstNode {
    let left = parseNot();
    while (is("keyword") && tokenValue(cur()) === "AND") {
      advance();
      const right = parseNot();
      left = { kind: "binary", op: "AND", left, right };
    }
    return left;
  }

  function parseNot(): AstNode {
    if (is("keyword") && tokenValue(cur()) === "NOT") {
      advance();
      return { kind: "unary", op: "NOT", operand: parseNot() };
    }
    return parseCompare();
  }

  function parseCompare(): AstNode {
    const left = parseAdd();
    if (is("op")) {
      const op = tokenValue(cur());
      if (op === ">" || op === "<" || op === ">=" || op === "<=" || op === "==" || op === "!=" || op === "<>") {
        advance();
        const right = parseAdd();
        return { kind: "binary", op, left, right };
      }
    }
    return left;
  }

  function parseAdd(): AstNode {
    let left = parseMul();
    while (is("op") && (tokenValue(cur()) === "+" || tokenValue(cur()) === "-")) {
      const op = tokenValue(cur())!;
      advance();
      const right = parseMul();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseMul(): AstNode {
    let left = parsePow();
    while (is("op") && (tokenValue(cur()) === "*" || tokenValue(cur()) === "/" || tokenValue(cur()) === "%")) {
      const op = tokenValue(cur())!;
      advance();
      const right = parsePow();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parsePow(): AstNode {
    let left = parseUnary();
    while (is("op") && tokenValue(cur()) === "^") {
      advance();
      const right = parseUnary();
      left = { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  function parseUnary(): AstNode {
    if (is("op") && tokenValue(cur()) === "-") {
      advance();
      return { kind: "unary", op: "-", operand: parseUnary() };
    }
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(node: AstNode): AstNode {
    while (is("[")) {
      advance();
      const offset = parseExpression();
      expect("]");
      node = { kind: "lookback", target: node, offset };
    }
    return node;
  }

  function parsePrimary(): AstNode {
    if (is("number")) {
      const t = advance();
      const value = parseFloat(tokenValue(t));
      if (Number.isNaN(value)) throw new ParseError("Invalid number");
      return { kind: "number", value };
    }
    if (is("string")) {
      const t = advance();
      return { kind: "string", value: tokenValue(t) };
    }
    if (is("(")) {
      advance();
      const expr = parseExpression();
      expect(")");
      return expr;
    }
    if (is("id")) {
      const t = advance();
      const name = tokenValue(t);
      if (is("[")) {
        advance();
        const lookback = parseExpression();
        expect("]");
        return { kind: "variable", name, lookback };
      }
      if (is("(")) {
        advance();
        const args: AstNode[] = [];
        if (!is(")")) {
          args.push(parseExpression());
          while (is(",")) {
            advance();
            args.push(parseExpression());
          }
        }
        expect(")");
        return { kind: "call", name, args };
      }
      return { kind: "variable", name, lookback: null };
    }
    throw new ParseError(`Unexpected token in expression: ${JSON.stringify(cur())}`);
  }

  return { assignments, filter, resultShaping };
}
