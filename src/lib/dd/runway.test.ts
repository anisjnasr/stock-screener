import { describe, expect, it } from "vitest";
import { computeRunway, computeTtmOperatingCashFlow, runwaySeverity } from "@/lib/dd/runway";
import type { XbrlUsdEntry } from "@/lib/dd/edgar";

describe("computeTtmOperatingCashFlow", () => {
  it("returns the annual value when only a 10-K is available", () => {
    const entries: XbrlUsdEntry[] = [
      { start: "2025-01-01", end: "2025-12-31", val: -12_000_000, form: "10-K" },
    ];
    const res = computeTtmOperatingCashFlow(entries);
    expect(res.method).toBe("annual_only");
    expect(res.ttm).toBe(-12_000_000);
  });

  it("rolls forward FY - priorYTD + currentYTD when a newer 10-Q exists", () => {
    const entries: XbrlUsdEntry[] = [
      // last full year (FY2025)
      { start: "2025-01-01", end: "2025-12-31", val: -12_000_000, form: "10-K" },
      // prior-year 9-month YTD (Jan–Sep 2025)
      { start: "2025-01-01", end: "2025-09-30", val: -9_000_000, form: "10-Q" },
      // current 9-month YTD (Jan–Sep 2026) — latest
      { start: "2026-01-01", end: "2026-09-30", val: -10_500_000, form: "10-Q" },
    ];
    const res = computeTtmOperatingCashFlow(entries);
    expect(res.method).toBe("rollforward");
    // -12,000,000 - (-9,000,000) + (-10,500,000) = -13,500,000
    expect(res.ttm).toBe(-13_500_000);
  });

  it("returns insufficient when nothing usable", () => {
    expect(computeTtmOperatingCashFlow([]).method).toBe("insufficient");
    expect(computeTtmOperatingCashFlow(null).ttm).toBeNull();
  });
});

describe("computeRunway", () => {
  it("flags cash-flow positive companies", () => {
    const r = computeRunway(50_000_000, 4_000_000);
    expect(r.cash_flow_positive).toBe(true);
    expect(r.runway_months).toBeNull();
  });

  it("computes monthly burn and runway for cash-burning companies", () => {
    // TTM OCF -12M → burn 1M/mo; 6M cash → 6.0 months
    const r = computeRunway(6_000_000, -12_000_000);
    expect(r.cash_flow_positive).toBe(false);
    expect(r.monthly_burn).toBe(1_000_000);
    expect(r.runway_months).toBe(6);
  });

  it("returns null runway when TTM OCF is missing", () => {
    expect(computeRunway(6_000_000, null).runway_months).toBeNull();
  });
});

describe("runwaySeverity", () => {
  it("maps to red/amber/green buckets", () => {
    expect(runwaySeverity(3)).toBe("red");
    expect(runwaySeverity(6)).toBe("amber");
    expect(runwaySeverity(12)).toBe("amber");
    expect(runwaySeverity(18)).toBe("green");
    expect(runwaySeverity(null)).toBeNull();
  });
});
