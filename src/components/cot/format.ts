// Formatting helpers for the COT panel.

/** Compact signed contract count, e.g. +485.4K, -1.10M, +12.3K, 0. */
export function formatSignedCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

/** Plain compact number (no forced sign) for open interest etc. */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-16" -> "Jun 16, 2026". */
export function formatReportDate(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 10) return "—";
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return "—";
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Short axis tick: "Jun '26". */
export function formatAxisDate(ymd: string): string {
  if (!ymd || ymd.length < 7) return ymd;
  const [y, m] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m) return ymd;
  return `${MONTHS[m - 1]} '${String(y).slice(2)}`;
}
