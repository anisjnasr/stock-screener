/**
 * Lexer for Nino Script parser. Produces a stream of tokens.
 */

export type Token =
  | { type: "number"; value: string }
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

const KEYWORDS = new Set(["AND", "OR", "NOT"]);
const MULTI_OPS = ["<>", ">=", "<="];
const SINGLE_OPS = "><=+-*/^";

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
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i]!;

    if (isSpace(c)) {
      i++;
      continue;
    }

    if (isDigit(c) || (c === "." && i + 1 < n && isDigit(source[i + 1]!))) {
      let val = "";
      while (i < n && (isDigit(source[i]!) || source[i] === ".")) {
        val += source[i];
        i++;
      }
      tokens.push({ type: "number", value: val });
      continue;
    }

    if (isLetter(c) || c === "_") {
      let val = "";
      while (i < n && (isLetter(source[i]!) || isDigit(source[i]!) || source[i] === "_")) {
        val += source[i];
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
      if (source.slice(i, i + op.length) === op) {
        tokens.push({ type: "op", value: op });
        i += op.length;
        found = true;
        break;
      }
    }
    if (found) continue;

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
        i++;
    }
  }

  tokens.push({ type: "eof" });
  return tokens;
}
