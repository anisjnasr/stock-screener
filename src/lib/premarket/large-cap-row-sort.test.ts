import { describe, expect, it } from "vitest";
import { sortLargeCapRows } from "@/lib/premarket/large-cap-row-sort";

describe("sortLargeCapRows", () => {
  it("sorts Trade above No Trade", () => {
    const rows = [
      { ticker: "ZZ", status: "done" as const, verdict: { verdict: "No Trade", bias: "Neutral", scenarios: [] } },
      { ticker: "AA", status: "done" as const, verdict: { verdict: "Trade", bias: "Bullish", scenarios: [{ confidence: "Low" }] } },
      { ticker: "BB", status: "done" as const, verdict: { verdict: "Trade", bias: "Bullish", scenarios: [{ confidence: "High" }] } },
    ];
    const sorted = sortLargeCapRows(rows);
    expect(sorted.map((r) => r.ticker)).toEqual(["BB", "AA", "ZZ"]);
  });

  it("sorts by confidence then bullish before bearish before neutral", () => {
    const rows = [
      {
        ticker: "NEU",
        status: "done" as const,
        verdict: { verdict: "Trade", bias: "Neutral", scenarios: [{ confidence: "High" }] },
      },
      {
        ticker: "BEAR",
        status: "done" as const,
        verdict: { verdict: "Trade", bias: "Bearish", scenarios: [{ confidence: "High" }] },
      },
      {
        ticker: "BULL",
        status: "done" as const,
        verdict: { verdict: "Trade", bias: "Bullish", scenarios: [{ confidence: "High" }] },
      },
      {
        ticker: "MED",
        status: "done" as const,
        verdict: { verdict: "Trade", bias: "Bullish", scenarios: [{ confidence: "Medium" }] },
      },
    ];
    const sorted = sortLargeCapRows(rows);
    expect(sorted.map((r) => r.ticker)).toEqual(["BULL", "BEAR", "NEU", "MED"]);
  });

  it("keeps loading rows below analyzed groups", () => {
    const rows = [
      { ticker: "LD", status: "loading" as const },
      { ticker: "NT", status: "done" as const, verdict: { verdict: "No Trade", scenarios: [] } },
    ];
    const sorted = sortLargeCapRows(rows);
    expect(sorted[0]?.ticker).toBe("NT");
    expect(sorted[1]?.ticker).toBe("LD");
  });
});
