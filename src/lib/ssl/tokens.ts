/**
 * Tokenizer for SSL syntax highlighting in the editor.
 */

export type TokenType =
  | "keyword"
  | "function"
  | "variable"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "identifier"
  | "space";

export type Token = { type: TokenType; value: string };

const KEYWORDS = new Set(["AND", "OR", "NOT", "SORT_BY", "LIMIT", "ASC"]);
const BUILTIN_FUNCTIONS = new Set([
  "MA",
  "EMA",
  "WMA",
  "SUM",
  "MAX",
  "MIN",
  "HHV",
  "LLV",
  "STDEV",
  "STDDEV",
  "ATR",
  "ATRP",
  "ROC",
  "RSI",
  "ABS",
  "RS",
  "INDRANK",
  "INDRS",
  "INDUSTRYRANK",
  "CROSS",
  "CROSSBELOW",
  "BARSSINCE",
  "IIF",
  "REF",
  "SQRT",
  "LOG",
  "ROUND",
  "VWAP",
  "BBTOP",
  "BBBOT",
  "TOPN",
  "BOTTOMN",
]);
const PRICE_VOLUME_VARS = new Set([
  "P",
  "C",
  "CLOSE",
  "O",
  "OPEN",
  "H",
  "HIGH",
  "L",
  "LOW",
  "V",
  "VOLUME",
]);
const SNAPSHOT_VARS = new Set([
  "MARKET_CAP",
  "MC",
  "IPO_DATE",
  "IPODATE",
  "SECTOR",
  "INDUSTRY",
  "NAME",
  "ADV",
  "DADV1M",
  "DADV3M",
  "DAYS_SINCE_IPO",
  "SHARES_OUT",
  "FLOAT",
  "SHORT_INT",
]);

const MULTI_CHAR_OPS = ["==", "!=", "<>", ">=", "<="];
const SINGLE_OPS = "><+-*/^%";
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
    const c = source[i]!;

    if (isSpace(c)) {
      let val = "";
      while (i < n && isSpace(source[i]!)) {
        val += source[i];
        i++;
      }
      tokens.push({ type: "space", value: val });
      continue;
    }

    if (c === "/" && i + 1 < n && source[i + 1] === "/") {
      let val = "";
      while (i < n && source[i] !== "\n") {
        val += source[i]!;
        i++;
      }
      tokens.push({ type: "identifier", value: val });
      continue;
    }
    if (c === "/" && i + 1 < n && source[i + 1] === "*") {
      let val = "/*";
      i += 2;
      while (i + 1 < n && !(source[i] === "*" && source[i + 1] === "/")) {
        val += source[i]!;
        i++;
      }
      if (i + 1 < n) {
        val += "*/";
        i += 2;
      }
      tokens.push({ type: "identifier", value: val });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let val = c;
      i++;
      while (i < n && source[i] !== quote) {
        val += source[i]!;
        i++;
      }
      if (i < n) {
        val += source[i]!;
        i++;
      }
      tokens.push({ type: "string", value: val });
      continue;
    }

    if (isDigit(c) || (c === "." && i + 1 < n && isDigit(source[i + 1]!))) {
      let val = "";
      while (i < n && (isDigit(source[i]!) || source[i] === ".")) {
        val += source[i]!;
        i++;
      }
      tokens.push({ type: "number", value: val });
      continue;
    }

    if (isLetter(c) || c === "_") {
      let val = "";
      while (i < n && (isLetter(source[i]!) || isDigit(source[i]!) || source[i] === "_")) {
        val += source[i]!;
        i++;
      }
      const upper = val.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: val });
      } else if (BUILTIN_FUNCTIONS.has(upper)) {
        tokens.push({ type: "function", value: val });
      } else if (PRICE_VOLUME_VARS.has(upper)) {
        tokens.push({ type: "variable", value: val });
      } else if (SNAPSHOT_VARS.has(upper)) {
        tokens.push({ type: "variable", value: val });
      } else {
        tokens.push({ type: "identifier", value: val });
      }
      continue;
    }

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

    if (c === "=") {
      tokens.push({ type: "operator", value: "=" });
      i++;
      continue;
    }

    if (SINGLE_OPS.includes(c)) {
      tokens.push({ type: "operator", value: c });
      i++;
      continue;
    }

    if (PUNCT.includes(c)) {
      tokens.push({ type: "punctuation", value: c });
      i++;
      continue;
    }

    tokens.push({ type: "identifier", value: c });
    i++;
  }

  return tokens;
}

export function tokenClass(type: TokenType): string {
  switch (type) {
    case "space":
      return "";
    case "keyword":
      return "text-violet-600 dark:text-violet-400/90 font-medium";
    case "function":
      return "text-sky-700 dark:text-sky-400/90";
    case "variable":
      return "text-amber-800/90 dark:text-amber-400/85";
    case "number":
      return "text-zinc-900 dark:text-zinc-100";
    case "string":
      return "text-emerald-700 dark:text-emerald-400/90";
    case "operator":
      return "text-zinc-600 dark:text-zinc-400";
    case "punctuation":
      return "text-zinc-500 dark:text-zinc-500";
    default:
      return "text-zinc-800 dark:text-zinc-200";
  }
}
