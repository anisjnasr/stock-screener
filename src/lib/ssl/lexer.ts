/**
 * Lexer for SSL. Produces a stream of tokens.
 */

import { stripSslComments } from "./strip-comments";

export type Token =
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "id"; value: string }
  | { type: "keyword"; value: string }
  | { type: "op"; value: string }
  | { type: "(" }
  | { type: ")" }
  | { type: "[" }
  | { type: "]" }
  | { type: "," }
  | { type: ";" }
  | { type: "eof" };

const KEYWORDS = new Set(["AND", "OR", "NOT", "SORT_BY", "LIMIT", "ASC"]);
/** Multi-char ops first (longest match). */
const MULTI_OPS = ["==", "!=", "<>", ">=", "<="];
const SINGLE_OPS = "><+-*/^%";

function isLetter(c: string): boolean {
  return /^[a-zA-Z]$/.test(c);
}
function isDigit(c: string): boolean {
  return /^[0-9]$/.test(c);
}
function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const input = stripSslComments(source);
  let i = 0;
  const n = input.length;

  while (i < n) {
    const c = input[i]!;

    if (isSpace(c)) {
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let val = "";
      while (i < n && input[i] !== quote) {
        val += input[i]!;
        i++;
      }
      if (i < n) i++;
      tokens.push({ type: "string", value: val });
      continue;
    }

    if (isDigit(c) || (c === "." && i + 1 < n && isDigit(input[i + 1]!))) {
      let val = "";
      while (i < n && (isDigit(input[i]!) || input[i] === ".")) {
        val += input[i]!;
        i++;
      }
      tokens.push({ type: "number", value: val });
      continue;
    }

    if (isLetter(c) || c === "_") {
      let val = "";
      while (i < n && (isLetter(input[i]!) || isDigit(input[i]!) || input[i] === "_")) {
        val += input[i]!;
        i++;
      }
      const upper = val.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: upper });
      } else {
        tokens.push({ type: "id", value: upper });
      }
      continue;
    }

    let found = false;
    for (const op of MULTI_OPS) {
      if (input.slice(i, i + op.length) === op) {
        tokens.push({ type: "op", value: op });
        i += op.length;
        found = true;
        break;
      }
    }
    if (found) continue;

    if (c === "=") {
      tokens.push({ type: "op", value: "=" });
      i++;
      continue;
    }

    if (SINGLE_OPS.includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }

    switch (c) {
      case "(":
        tokens.push({ type: "(" });
        i++;
        break;
      case ")":
        tokens.push({ type: ")" });
        i++;
        break;
      case "[":
        tokens.push({ type: "[" });
        i++;
        break;
      case "]":
        tokens.push({ type: "]" });
        i++;
        break;
      case ",":
        tokens.push({ type: "," });
        i++;
        break;
      case ";":
        tokens.push({ type: ";" });
        i++;
        break;
      default:
        throw new Error(`Unexpected character in SSL script: ${JSON.stringify(c)} at offset ${i}`);
    }
  }

  tokens.push({ type: "eof" });
  return tokens;
}
