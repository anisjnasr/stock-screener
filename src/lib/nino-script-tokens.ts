/**
 * Tokenizer for Nino Script syntax highlighting.
 * Produces tokens with types: keyword, function, variable, number, operator, punctuation.
 */

export type TokenType = "keyword" | "function" | "variable" | "number" | "operator" | "punctuation" | "identifier";

export type Token = { type: TokenType; value: string };

const KEYWORDS = new Set(["AND", "OR", "NOT"]);
const BUILTIN_FUNCTIONS = new Set([
  "MA", "EMA", "SUM", "MAX", "MIN", "ATR", "ATRP", "ROC", "RVOL", "ABS",
]);
/** P and C both mean Close; O, H, L, V are Open, High, Low, Volume. */
const PRICE_VOLUME_VARS = new Set(["P", "C", "O", "H", "L", "V"]);

const MULTI_CHAR_OPS = ["<>", ">=", "<="];
const SINGLE_OPS = "><=+-*/^";
const PUNCT = "()[],;";

function isLetter(c: string): boolean {
  return /^[a-zA-Z]$/.test(c);
}
function isDigit(c: string): boolean {
  return /^[0-9]$/.test(c);
}
function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const start = i;
    const c = source[i]!;

    if (isSpace(c)) {
      i++;
      continue;
    }

    // Number: digits and optional . and more digits
    if (isDigit(c) || (c === "." && i + 1 < n && isDigit(source[i + 1]!))) {
      let val = "";
      while (i < n && (isDigit(source[i]!) || source[i] === ".")) {
        val += source[i];
        i++;
      }
      tokens.push({ type: "number", value: val });
      continue;
    }

    // Identifier or keyword/function/variable
    if (isLetter(c) || c === "_") {
      let val = "";
      while (i < n && (isLetter(source[i]!) || isDigit(source[i]!) || source[i] === "_")) {
        val += source[i];
        i++;
      }
      const upper = val.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: val });
      } else if (BUILTIN_FUNCTIONS.has(upper)) {
        tokens.push({ type: "function", value: val });
      } else if (PRICE_VOLUME_VARS.has(upper)) {
        tokens.push({ type: "variable", value: val });
      } else {
        tokens.push({ type: "identifier", value: val });
      }
      continue;
    }

    // Multi-char operators
    let found = false;
    for (const op of MULTI_CHAR_OPS) {
      if (source.slice(i, i + op.length) === op) {
        tokens.push({ type: "operator", value: op });
        i += op.length;
        found = true;
        break;
      }
    }
    if (found) continue;

    // Single-char operator
    if (SINGLE_OPS.includes(c)) {
      tokens.push({ type: "operator", value: c });
      i++;
      continue;
    }

    // Punctuation
    if (PUNCT.includes(c)) {
      tokens.push({ type: "punctuation", value: c });
      i++;
      continue;
    }

    // Unknown: treat as single char so we don't lose it (e.g. in strings later)
    tokens.push({ type: "identifier", value: c });
    i++;
  }

  return tokens;
}

/**
 * Convert token type to Tailwind class for syntax highlighting (light and dark).
 */
export function tokenClass(type: TokenType): string {
  switch (type) {
    case "keyword":
      return "text-purple-600 dark:text-purple-400 font-semibold";
    case "function":
      return "text-blue-600 dark:text-blue-400";
    case "variable":
      return "text-amber-700 dark:text-amber-400";
    case "number":
      return "text-emerald-600 dark:text-emerald-400";
    case "operator":
      return "text-zinc-700 dark:text-zinc-300";
    case "punctuation":
      return "text-zinc-500 dark:text-zinc-400";
    default:
      return "text-zinc-800 dark:text-zinc-200";
  }
}
