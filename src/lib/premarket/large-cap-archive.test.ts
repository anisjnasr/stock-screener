import { describe, expect, it } from "vitest";
import {
  computeForwardTestStats,
  filterArchiveRows,
  resolveArchiveOutcome,
  scenarioHighlightRank,
  type LargeCapArchiveRow,
} from "@/lib/premarket/large-cap-archive";

function row(partial: Partial<LargeCapArchiveRow> & Pick<LargeCapArchiveRow, "ticker" | "trading_date">): LargeCapArchiveRow {
  return {
    result_json: { scenarios: [] },
    outcome: null,
    scoring_json: null,
    scored: false,
    outcome_scored_at: null,
    logged_at: "2026-05-17T12:00:00Z",
    updated_at: "2026-05-17T12:00:00Z",
    ...partial,
  };
}

describe("large-cap-archive", () => {
  it("resolves pending vs scored outcomes", () => {
    expect(resolveArchiveOutcome(row({ ticker: "A", trading_date: "2026-05-17", scored: false }))).toBe("Pending");
    expect(
      resolveArchiveOutcome(
        row({ ticker: "A", trading_date: "2026-05-17", scored: true, outcome: "Scenario 2" })
      )
    ).toBe("Scenario 2");
  });

  it("highlights winning scenario rank", () => {
    expect(scenarioHighlightRank("Scenario 1")).toBe(1);
    expect(scenarioHighlightRank("None")).toBeNull();
    expect(scenarioHighlightRank("Ambiguous")).toBeNull();
  });

  it("filters by ticker, date, and outcome", () => {
    const rows = [
      row({ ticker: "AAPL", trading_date: "2026-05-17", scored: true, outcome: "Scenario 1" }),
      row({ ticker: "MSFT", trading_date: "2026-05-18", scored: true, outcome: "None" }),
    ];
    const filtered = filterArchiveRows(rows, {
      ticker: "AAPL",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-17",
      outcome: "Scenario 1",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.ticker).toBe("AAPL");
  });

  it("computes hit rate excluding pending and ambiguous", () => {
    const rows = [
      row({ ticker: "A", trading_date: "2026-05-10", scored: true, outcome: "Scenario 1" }),
      row({ ticker: "B", trading_date: "2026-05-11", scored: true, outcome: "None" }),
      row({ ticker: "C", trading_date: "2026-05-12", scored: true, outcome: "Ambiguous" }),
      row({ ticker: "D", trading_date: "2026-05-13", scored: false }),
    ];
    const stats = computeForwardTestStats(rows);
    expect(stats.resolved).toBe(2);
    expect(stats.playedOut).toBe(1);
    expect(stats.hitRatePct).toBe(50);
    expect(stats.ambiguous).toBe(1);
    expect(stats.pending).toBe(1);
  });
});
