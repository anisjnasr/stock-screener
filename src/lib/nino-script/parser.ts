/**
 * Recursive-descent parser for Nino Script.
 */

import type { Token } from "./lexer";
import type { AstNode, ScriptAst } from "./ast";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export function parseScript(source: string): ScriptAst {
  const tokens = lex(source);
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
    const t = cur();
    return types.includes(t.type);
  }
  function expect(type: Token["type"], msg?: string): Token {
    const t = cur();
    if (t.type !== type) {
      throw new ParseError(msg ?? `Expected ${type}, got ${t.type}`);
    }
    return advance();
  }

  const assignments: Array<{ name: string; expr: AstNode }> = [];

  // Optional: id = expr ;
  while (is("id")) {
    const idToken = cur();
    if (idToken.type !== "id") break;
    const next = tokens[pos + 1];
    if (!next || next.type !== "op" || tokenValue(next) !== "=") break;
    const name = tokenValue(idToken);
    advance(); // id
    advance(); // =
    const expr = parseExpression();
    expect(";", "Expected ; after assignment");
    assignments.push({ name, expr });
  }

  const expression = parseExpression();
  expect("eof", "Unexpected token after expression");

  return { assignments, expression };

  function parseExpression(): AstNode {
    return parseOr();
  }

  function tokenValue(t: Token): string {
    return "value" in t ? (t as { value: string }).value : "";
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
    let left = parseAdd();
    if (is("op")) {
      const op = tokenValue(cur());
      if (op === ">" || op === "<" || op === ">=" || op === "<=" || op === "=" || op === "<>") {
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
      const op = tokenValue(cur());
      advance();
      const right = parseMul();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseMul(): AstNode {
    let left = parseUnary();
    while (is("op") && (tokenValue(cur()) === "*" || tokenValue(cur()) === "/" || tokenValue(cur()) === "^")) {
      const op = tokenValue(cur());
      advance();
      const right = parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseUnary(): AstNode {
    if (is("op") && tokenValue(cur()) === "-") {
      advance();
      return { kind: "unary", op: "-", operand: parseUnary() };
    }
    if (is("id") && tokenValue(cur()) === "ABS") {
      advance();
      expect("(");
      const operand = parseExpression();
      expect(")");
      return { kind: "call", name: "ABS", args: [operand] };
    }
    return parsePrimary();
  }

  function parsePrimary(): AstNode {
    if (is("number")) {
      const t = advance();
      const value = parseFloat(tokenValue(t));
      if (Number.isNaN(value)) throw new ParseError("Invalid number");
      return { kind: "number", value };
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
    throw new ParseError(`Unexpected token: ${JSON.stringify(cur())}`);
  }
}

// Import lex here to avoid circular dependency at runtime (parser uses lex)
import { lex } from "./lexer";
