/**
 * Shared compact number formatting for pre-market tables and large filter fields.
 */

/** Full USD integers with thousands separators (editing large filter inputs). */
export function formatUsdIntInputDisplay(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-US");
}

/** Compact filter display: ≥ 1,000 uses `100 K`, `1.5 M`, `10 B` (space before suffix); below that plain integers. */
export function abbreviateUsdFilterDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1_000) {
    return `${sign}${Math.round(n).toLocaleString("en-US")}`;
  }
  return `${sign}${abbreviateMagnitude(abs)}`;
}

function abbreviateMagnitude(abs: number): string {
  if (abs >= 1e12) return `${tierRatio(abs / 1e12)} T`;
  if (abs >= 1e9) return `${tierRatio(abs / 1e9)} B`;
  if (abs >= 1e6) return `${tierRatio(abs / 1e6)} M`;
  if (abs >= 1e3) return `${tierRatio(abs / 1e3)} K`;
  return String(Math.round(abs));
}

/** Format a signed ratio (e.g. billions) for compact display; `abs` used for precision tiers. */
function tierRatio(v: number): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  let body: string;
  if (a >= 100) body = String(Math.round(a));
  else if (a >= 10) body = (Math.round(a * 10) / 10).toFixed(1).replace(/\.0$/, "");
  else body = (Math.round(a * 100) / 100).toFixed(2).replace(/\.00$/, "");
  return sign + body;
}

/**
 * Parse filter text: plain integers, commas, or optional K/M/B/T suffix (with or without space).
 * Examples: `10000000`, `10,000,000`, `10 M`, `10M`, `2.5 B`
 */
export function parseFlexibleFilterNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const noComma = trimmed.replace(/,/g, "");
  const compact = noComma.replace(/\s/g, "");
  const m = compact.match(/^([+-]?\d*\.?\d+)([KMBT])?$/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const suf = (m[2] ?? "").toUpperCase();
  const mult = suf === "K" ? 1e3 : suf === "M" ? 1e6 : suf === "B" ? 1e9 : suf === "T" ? 1e12 : 1;
  return base * mult;
}

/** Table / SIP line: `9.17 M`, `100 K` (space before K/M/B/T). */
export function formatScreenerCompact(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const x = Math.abs(n);
  if (x < 1000) return `${sign}${Math.round(n)}`;
  if (x >= 1e12) return `${sign}${tierRatio(n / 1e12)} T`;
  if (x >= 1e9) return `${sign}${tierRatio(n / 1e9)} B`;
  if (x >= 1e6) return `${sign}${tierRatio(n / 1e6)} M`;
  if (x >= 1e3) return `${sign}${tierRatio(n / 1e3)} K`;
  return `${sign}${Math.round(n)}`;
}
