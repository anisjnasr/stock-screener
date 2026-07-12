import { describe, expect, it } from "vitest";
import {
  computeTrailingPercentiles,
  mmPercentileBandClass,
} from "@/lib/market-monitor-percentiles";

describe("computeTrailingPercentiles", () => {
  it("returns null until minHistory is reached", () => {
    const series = Array.from({ length: 5 }, (_, i) => i);
    expect(computeTrailingPercentiles(series, 252, 6)).toEqual([null, null, null, null, null]);
  });

  it("ranks strictly-less values inclusive of today", () => {
    // window [10,20,30,40,50]; today=50 -> 4/5 = 80
    const series = [10, 20, 30, 40, 50];
    const p = computeTrailingPercentiles(series, 252, 1);
    expect(p[0]).toBe(0); // nothing strictly less
    expect(p[4]).toBe(80);
  });

  it("gives all-time high < 100 and all-time low = 0", () => {
    const series = [5, 5, 5, 9, 1];
    const p = computeTrailingPercentiles(series, 252, 1);
    expect(p[3]).toBe(75); // 3 of 4 strictly less
    expect(p[4]).toBe(0);
  });

  it("respects the lookback window size", () => {
    const series = [100, 1, 2, 3];
    // lookback 3 at idx 3 -> window [1,2,3], today=3 -> 2/3 ≈ 66.7
    const p = computeTrailingPercentiles(series, 3, 1);
    expect(p[3]).toBeCloseTo(66.666, 2);
  });

  it("ignores null/NaN entries in the window", () => {
    const series = [1, null, 2, 3];
    const p = computeTrailingPercentiles(series, 252, 1);
    expect(p[3]).toBeCloseTo(66.666, 2); // window {1,2,3}, 2 strictly less
  });
});

describe("mmPercentileBandClass", () => {
  it("colors bullish-when-high correctly", () => {
    expect(mmPercentileBandClass(95, "bullish")).toBe("ws-mm-heat-green-very");
    expect(mmPercentileBandClass(90, "bullish")).toBe("ws-mm-heat-green-very");
    expect(mmPercentileBandClass(70, "bullish")).toBe("ws-mm-heat-green-strong");
    expect(mmPercentileBandClass(50, "bullish")).toBe("");
    expect(mmPercentileBandClass(30, "bullish")).toBe("ws-mm-heat-red-strong");
    expect(mmPercentileBandClass(10, "bullish")).toBe("ws-mm-heat-red-very");
  });

  it("inverts for bearish-when-high columns", () => {
    expect(mmPercentileBandClass(95, "bearish")).toBe("ws-mm-heat-red-very");
    expect(mmPercentileBandClass(70, "bearish")).toBe("ws-mm-heat-red-strong");
    expect(mmPercentileBandClass(50, "bearish")).toBe("");
    expect(mmPercentileBandClass(30, "bearish")).toBe("ws-mm-heat-green-strong");
    expect(mmPercentileBandClass(5, "bearish")).toBe("ws-mm-heat-green-very");
  });

  it("returns neutral when percentile is unavailable", () => {
    expect(mmPercentileBandClass(null, "bullish")).toBe("");
  });
});
