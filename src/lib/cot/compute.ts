// COT derived metrics (Task 5): net, spread, and the 3-year COT index.
// Pure functions over raw cot_weekly rows so they can be unit-tested and reused.

import type { CotSeriesPoint, CotWeeklyRow } from "./contracts";

export const COT_INDEX_WINDOW = 156; // trailing weeks (~3 years)

function net(long: number | null, short: number | null): number | null {
  if (long === null || short === null) return null;
  return long - short;
}

/**
 * COT index per §4: for week t, scale large_spec_net into the [min,max] range of the
 * trailing 156 weeks (inclusive of t), x100, rounded. Early weeks use the shorter
 * window available. Returns null when large_spec_net is missing; 50 for a flat range.
 */
function cotIndexAt(largeSpecNets: (number | null)[], t: number): number | null {
  const current = largeSpecNets[t];
  if (current === null) return null;
  const start = Math.max(0, t - (COT_INDEX_WINDOW - 1));
  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i <= t; i++) {
    const v = largeSpecNets[i];
    if (v === null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max === min) return 50;
  return Math.round(((current - min) / (max - min)) * 100);
}

/**
 * Build the per-week series (oldest -> newest) plus the latest point for one contract.
 * `rows` must be ordered oldest -> newest.
 */
export function computeContractSeries(rows: CotWeeklyRow[]): {
  series: CotSeriesPoint[];
  latest: CotSeriesPoint | null;
} {
  const largeSpecNets = rows.map((r) => net(r.large_spec_long, r.large_spec_short));

  const series: CotSeriesPoint[] = rows.map((r, i) => {
    const commNet = net(r.comm_long, r.comm_short);
    const largeSpecNet = largeSpecNets[i];
    const smallSpecNet = net(r.small_spec_long, r.small_spec_short);
    const spread =
      largeSpecNet === null || commNet === null ? null : largeSpecNet - commNet;
    return {
      date: r.report_date,
      comm_net: commNet,
      large_spec_net: largeSpecNet,
      small_spec_net: smallSpecNet,
      spread,
      cot_index: cotIndexAt(largeSpecNets, i),
      open_interest: r.open_interest,
    };
  });

  return { series, latest: series.length ? series[series.length - 1] : null };
}
