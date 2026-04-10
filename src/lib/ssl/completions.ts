/**
 * SSL editor autocomplete: static symbols aligned with parser reserved names + user assignments.
 */

import { SSL_RESERVED_IDENTIFIERS } from "./parser";

export type SslCompletionKind = "keyword" | "function" | "variable" | "field" | "user";

export type SslCompletionItem = {
  label: string;
  insertText: string;
  detail?: string;
  kind: SslCompletionKind;
};

/** Extra symbols the lexer knows but not listed in SSL_RESERVED_IDENTIFIERS. */
const EXTRA_SYMBOLS = ["P", "MC", "IPODATE", "STDDEV"] as const;

const LOGICAL_KEYWORDS = new Set(["AND", "OR", "NOT", "ASC"]);

const SHAPING_KEYWORDS = new Set(["SORT_BY", "LIMIT"]);

/** Insert `name(` — except VWAP() and similar zero-arg forms. */
const FUNCTIONS_PAREN = new Set(
  [
    "MA",
    "EMA",
    "WMA",
    "HHV",
    "LLV",
    "SUM",
    "STDEV",
    "STDDEV",
    "ATR",
    "ATRP",
    "ROC",
    "RSI",
    "RS",
    "INDRANK",
    "INDRS",
    "INDUSTRYRANK",
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
    "BBTOP",
    "BBBOT",
    "TOPN",
    "BOTTOMN",
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
    "TODAY",
    "DATEDIFF",
    "TRADINGDAYSSINCE",
    "DAYOFWEEK",
  ].map((s) => s.toUpperCase())
);

const DETAIL: Record<string, string> = {
  MA: "MA(array, period) — simple moving average",
  EMA: "EMA(array, period)",
  WMA: "WMA(array, period)",
  HHV: "HHV(array, period) — highest in window",
  LLV: "LLV(array, period)",
  SUM: "SUM(array, period)",
  STDEV: "STDEV(array, period) — stdev",
  RS: "RS(0|1|3|6|12) — RS percentile (0 = 1w)",
  INDRANK: "IndRank(1|3|6|12) — industry rank",
  INDRS: "alias IndRank",
  INDUSTRYRANK: "alias IndRank",
  TOPN: "TopN(expr, n)",
  BOTTOMN: "BottomN(expr, n)",
  SORT_BY: "SORT_BY = expr; (with optional ASC)",
  LIMIT: "LIMIT = n;",
  REF: "Ref(array, negativePeriod)",
  IIF: "IIf(cond, trueVal, falseVal)",
  VWAP: "VWAP()",
  ATRP: "ATRP(period) — ATR % of close",
  Q: "Q(field, n) — quarterly value; n=0 latest; [s] shifts quarters",
  AVG_Q: "AVG_Q(field, count) — mean of count quarters from optional [s]",
  MIN_Q: "MIN_Q(field, count) — min over count quarters from [s]",
  MAX_Q: "MAX_Q(field, count) — max over count quarters from [s]",
  SUM_Q: "SUM_Q(field, count) — sum over count quarters from [s]",
  STREAK_Q: "STREAK_Q — not evaluated in engine",
  A: "A(field, n) — annual value; [s] shifts fiscal years",
  AVG_A: "AVG_A(field, count) — mean of count fiscal years from [s]",
  MIN_A: "MIN_A(field, count)",
  MAX_A: "MAX_A(field, count)",
  SUM_A: "SUM_A(field, count)",
  STREAK_A: "STREAK_A — not evaluated in engine",
};

function kindForSymbol(upper: string): SslCompletionKind {
  if (LOGICAL_KEYWORDS.has(upper) || SHAPING_KEYWORDS.has(upper)) return "keyword";
  if (FUNCTIONS_PAREN.has(upper) || upper === "VWAP") return "function";
  if (
    [
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
    ].includes(upper)
  ) {
    return "field";
  }
  if (
    [
      "O",
      "OPEN",
      "H",
      "HIGH",
      "L",
      "LOW",
      "C",
      "CLOSE",
      "P",
      "V",
      "VOLUME",
    ].includes(upper)
  ) {
    return "variable";
  }
  return "field";
}

function insertTextFor(upper: string): string {
  if (LOGICAL_KEYWORDS.has(upper) || SHAPING_KEYWORDS.has(upper)) {
    if (upper === "SORT_BY") return "SORT_BY = ";
    if (upper === "LIMIT") return "LIMIT = ";
    return upper;
  }
  if (upper === "VWAP") return "VWAP()";
  if (FUNCTIONS_PAREN.has(upper)) {
    if (upper === "STDDEV") return "STDEV(";
    return `${upper}(`;
  }
  return upper;
}

let _staticCache: SslCompletionItem[] | null = null;

/** All built-in completion items (uppercase labels). */
export function getStaticCompletions(): SslCompletionItem[] {
  if (_staticCache) return _staticCache;
  const seen = new Set<string>();
  const out: SslCompletionItem[] = [];

  const add = (upper: string) => {
    if (seen.has(upper)) return;
    seen.add(upper);
    const kind = kindForSymbol(upper);
    out.push({
      label: upper,
      insertText: insertTextFor(upper),
      detail: DETAIL[upper],
      kind,
    });
  };

  for (const id of SSL_RESERVED_IDENTIFIERS) {
    add(id);
  }
  for (const id of EXTRA_SYMBOLS) {
    add(id.toUpperCase());
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  _staticCache = out;
  return out;
}

/** Strip // and /* *\/ comments roughly for assignment scanning. */
function stripCommentsForScan(source: string): string {
  let s = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = s.split("\n");
  return lines
    .map((line) => {
      const q = line.indexOf("//");
      return q >= 0 ? line.slice(0, q) : line;
    })
    .join("\n");
}

/**
 * User-defined variable names from `Name = expr;` lines (case-insensitive; returned uppercase).
 */
export function extractUserVariableNames(script: string): string[] {
  const scanned = stripCommentsForScan(script);
  const names = new Set<string>();
  const assignRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm;
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(scanned)) !== null) {
    const raw = m[1]!;
    const upper = raw.toUpperCase();
    if (SSL_RESERVED_IDENTIFIERS.has(upper)) continue;
    if (upper === "SORT_BY" || upper === "LIMIT") continue;
    names.add(upper);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function matchesPrefix(label: string, prefix: string): boolean {
  if (!prefix) return true;
  return label.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Merged static + user vars, filtered by prefix. User vars first, then builtins.
 */
export function filterCompletions(script: string, prefix: string): SslCompletionItem[] {
  const staticItems = getStaticCompletions();
  const userNames = extractUserVariableNames(script);
  const userItems: SslCompletionItem[] = userNames
    .filter((n) => matchesPrefix(n, prefix))
    .map((n) => ({
      label: n,
      insertText: n,
      kind: "user" as const,
      detail: "Your variable",
    }));

  const userSet = new Set(userNames);
  const builtinFiltered = staticItems.filter((item) => matchesPrefix(item.label, prefix) && !userSet.has(item.label));

  return [...userItems, ...builtinFiltered];
}
