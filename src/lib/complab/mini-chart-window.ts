import type { CompLabCandle } from "@/lib/complab/chart-series";

export type CompMiniChartWindow = {
  window: CompLabCandle[];
  compIndex: number;
  postSetupStartIndex: number;
};

/** 35 sessions ending at comp date (inclusive) + up to 5 sessions after. */
export function sliceCompMiniChartWindow(
  candles: CompLabCandle[],
  compDate: string
): CompMiniChartWindow {
  const sorted = candles.slice().sort((a, b) => a.date.localeCompare(b.date));
  const idx = sorted.findIndex((c) => c.date === compDate);
  if (idx < 0) return { window: [], compIndex: -1, postSetupStartIndex: -1 };

  const from = Math.max(0, idx - 34);
  const to = Math.min(sorted.length - 1, idx + 5);
  const window = sorted.slice(from, to + 1);
  const compIndex = idx - from;
  return {
    window,
    compIndex,
    postSetupStartIndex: compIndex + 1,
  };
}
