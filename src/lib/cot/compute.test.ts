import { describe, expect, it } from "vitest";
import { computeContractSeries } from "./compute";
import type { CotWeeklyRow } from "./contracts";

function row(date: string, over: Partial<CotWeeklyRow> = {}): CotWeeklyRow {
  return {
    report_date: date,
    contract_key: "ES",
    report_type: "tff",
    open_interest: 1000,
    comm_long: 100,
    comm_short: 100,
    large_spec_long: 100,
    large_spec_short: 100,
    small_spec_long: 50,
    small_spec_short: 50,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("computeContractSeries", () => {
  it("computes net and spread (large_spec_net - comm_net)", () => {
    const { latest } = computeContractSeries([
      row("2026-01-06", {
        comm_long: 50,
        comm_short: 200, // comm_net = -150
        large_spec_long: 300,
        large_spec_short: 100, // large_spec_net = 200
        small_spec_long: 80,
        small_spec_short: 30, // small_spec_net = 50
      }),
    ]);
    expect(latest?.comm_net).toBe(-150);
    expect(latest?.large_spec_net).toBe(200);
    expect(latest?.small_spec_net).toBe(50);
    expect(latest?.spread).toBe(350); // 200 - (-150)
  });

  it("scales the COT index across the trailing large-spec-net range", () => {
    // large_spec_net = 0, 100, 50 over three weeks -> min 0, max 100.
    const rows = [
      row("2026-01-06", { large_spec_long: 100, large_spec_short: 100 }), // net 0 -> idx 50 (flat window)
      row("2026-01-13", { large_spec_long: 200, large_spec_short: 100 }), // net 100 -> max -> 100
      row("2026-01-20", { large_spec_long: 150, large_spec_short: 100 }), // net 50 -> mid -> 50
    ];
    const { series } = computeContractSeries(rows);
    expect(series[0].cot_index).toBe(50); // single point, flat range
    expect(series[1].cot_index).toBe(100); // new high
    expect(series[2].cot_index).toBe(50); // (50-0)/(100-0)*100
  });

  it("returns null small_spec_net (and keeps other metrics) when small-spec data is missing", () => {
    const { latest } = computeContractSeries([
      row("2026-01-06", { small_spec_long: null, small_spec_short: null }),
    ]);
    expect(latest?.small_spec_net).toBeNull();
    expect(latest?.comm_net).toBe(0);
    expect(latest?.cot_index).toBe(50);
  });
});
