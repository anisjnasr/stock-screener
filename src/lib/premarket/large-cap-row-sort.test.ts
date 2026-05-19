import { describe, expect, it } from "vitest";
import { sortLargeCapRows } from "@/lib/premarket/large-cap-row-sort";

describe("sortLargeCapRows", () => {
  it("sorts Trade above No Trade", () => {
    const rows = [
      { ticker: "ZZ", status: "done" as const, verdict: { verdict: "No Trade", scenarios: [] } },
      { ticker: "AA", status: "done" as const, verdict: { verdict: "Trade", scenarios: [{ confidence: "Low" }] } },
      { ticker: "BB", status: "done" as const, verdict: { verdict: "Trade", scenarios: [{ confidence: "High" }] } },
    ];
    const sorted = sortLargeCapRows(rows);
    expect(sorted.map((r) => r.ticker)).toEqual(["BB", "AA", "ZZ"]);
  });

  it("keeps loading rows below Trade and No Trade groups", () => {
    const rows = [
      { ticker: "LD", status: "loading" as const },
      { ticker: "NT", status: "done" as const, verdict: { verdict: "No Trade", scenarios: [] } },
    ];
    const sorted = sortLargeCapRows(rows);
    expect(sorted[0]?.ticker).toBe("NT");
    expect(sorted[1]?.ticker).toBe("LD");
  });
});
