/** Strip trailing zeros after decimal (e.g. 319.00 → 319, 400.15 → 400.15, 0 → 0). */
function trimFixed2(scaled: number): string {
  let s = scaled.toFixed(2);
  s = s.replace(/(\.\d*?[1-9])0+$/, "$1");
  s = s.replace(/\.0+$/, "");
  return s;
}

/** Compact USD for revenue (Finnhub calendar uses raw dollars). Decimals only when nonzero. */
export function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${trimFixed2(n / 1e12)}T`;
  if (abs >= 1e9) return `$${trimFixed2(n / 1e9)}B`;
  if (abs >= 1e6) return `$${trimFixed2(n / 1e6)}m`;
  if (abs >= 1e3) return `$${trimFixed2(n / 1e3)}k`;
  return `$${trimFixed2(n)}`;
}

function isNum(x: number | null): x is number {
  return x != null && Number.isFinite(x);
}

/** e.g. `$10.0m / $8.0m` — prior from prior fiscal quarter row when ingested. */
export function formatRevDollarPair(current: number | null, prior: number | null): string {
  if (!isNum(current) && !isNum(prior)) return "—";
  const left = isNum(current) ? formatUsdCompact(current) : "—";
  const right = isNum(prior) ? formatUsdCompact(prior) : "—";
  return `${left} / ${right}`;
}

/** e.g. `$1.35 / $1.00` — EPS per share. */
export function formatEpsDollarPair(current: number | null, prior: number | null): string {
  if (!isNum(current) && !isNum(prior)) return "—";
  const left = isNum(current) ? `$${current.toFixed(2)}` : "—";
  const right = isNum(prior) ? `$${prior.toFixed(2)}` : "—";
  return `${left} / ${right}`;
}
