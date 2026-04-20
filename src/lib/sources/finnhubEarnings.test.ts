import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { FinnhubEarningsRaw } from "./finnhubEarnings";
import {
  mapFinnhubToInserts,
  normalizeReportTime,
  quarterYearFromDate,
  surprisePct,
} from "./finnhubEarnings";

describe("finnhubEarnings helpers", () => {
  it("computes surprise % vs estimate", () => {
    expect(surprisePct(1.62, 1.5)).toBeCloseTo(8, 0);
    expect(surprisePct(null, 1.5)).toBeNull();
    expect(surprisePct(1, 0)).toBeNull();
  });

  it("normalizes report hour buckets", () => {
    expect(normalizeReportTime("bmo")).toBe("bmo");
    expect(normalizeReportTime("AMC")).toBe("amc");
    expect(normalizeReportTime("during market")).toBe("dmh");
    expect(normalizeReportTime(null)).toBeNull();
  });

  it("derives calendar quarter from report date", () => {
    expect(quarterYearFromDate("2026-04-20")).toEqual({ quarter: 2, year: 2026 });
    expect(quarterYearFromDate("2026-01-03")).toEqual({ quarter: 1, year: 2026 });
  });

  it("maps fixture rows, filters universe, and dedupes", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "__fixtures__", "finnhub-earnings-sample.json"), "utf8")
    ) as { earningsCalendar: FinnhubEarningsRaw[] };
    const allowed = new Set(["IBM", "MSFT"]);
    const rows = mapFinnhubToInserts(raw.earningsCalendar, allowed);
    expect(rows).toHaveLength(2);

    const ibm = rows.find((r) => r.ticker === "IBM");
    expect(ibm?.report_time).toBe("amc");
    expect(ibm?.current_quarter_eps_surprise_pct).toBeCloseTo(8, 0);
    expect(ibm?.current_quarter_rev_surprise_pct).toBeGreaterThan(0);

    const msft = rows.find((r) => r.ticker === "MSFT");
    expect(msft?.report_time).toBe("bmo");
    expect(msft?.quarter).toBe(3);
    expect(msft?.year).toBe(2025);
  });
});
