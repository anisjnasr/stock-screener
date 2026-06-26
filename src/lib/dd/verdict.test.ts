import { describe, expect, it } from "vitest";
import {
  computeCashNeed,
  computeFloatRisk,
  computeRaisePressure,
  computeVerdict,
  type VerdictInputs,
} from "@/lib/dd/verdict";
import type { DDInstrument } from "@/lib/dd/types";

function inst(partial: Partial<DDInstrument>): DDInstrument {
  return {
    type: "ATM",
    label: "ATM",
    authorized_usd: null,
    used_usd: null,
    remaining_usd: null,
    share_count: null,
    exercise_or_conversion_price: null,
    is_variable_conversion: false,
    floor_price: null,
    expiry: null,
    is_prefunded: false,
    key_terms: null,
    status: "active",
    flags: [],
    source: "424B5 2026-01-01",
    potential_shares: null,
    open_ended: false,
    primary_flag: null,
    severity: null,
    ...partial,
  };
}

const base: VerdictInputs = {
  runway_months: 24,
  cash_flow_positive: false,
  float: 30_000_000,
  overhang_pct: 5,
  instruments: [],
  has_reverse_split_12mo: false,
};

describe("signal helpers", () => {
  it("float_risk buckets", () => {
    expect(computeFloatRisk(4_000_000)).toBe("high");
    expect(computeFloatRisk(10_000_000)).toBe("medium");
    expect(computeFloatRisk(50_000_000)).toBe("low");
  });

  it("cash_need buckets + profitable", () => {
    expect(computeCashNeed(3, false)).toBe("high");
    expect(computeCashNeed(9, false)).toBe("medium");
    expect(computeCashNeed(20, false)).toBe("low");
    expect(computeCashNeed(2, true)).toBe("low");
  });

  it("raise_pressure considers active facilities", () => {
    expect(computeRaisePressure(24, false, [inst({ flags: ["active"] })])).toBe("high");
    expect(computeRaisePressure(24, false, [inst({ type: "ELOC", status: "closed", flags: ["available"] })])).toBe(
      "medium"
    );
    expect(computeRaisePressure(24, false, [])).toBe("low");
  });
});

describe("computeVerdict", () => {
  it("is Bullish when clean", () => {
    expect(computeVerdict(base).verdict).toBe("Bullish");
  });

  it("is Bearish on high overhang", () => {
    const r = computeVerdict({ ...base, overhang_pct: 60 });
    expect(r.verdict).toBe("Bearish");
    expect(r.reason).toContain("High overhang");
  });

  it("is Bearish on short runway", () => {
    expect(computeVerdict({ ...base, runway_months: 4 }).verdict).toBe("Bearish");
  });

  it("is Bearish on toxic convertible", () => {
    const r = computeVerdict({
      ...base,
      instruments: [inst({ type: "convertible", flags: ["toxic"], is_variable_conversion: true, open_ended: true })],
    });
    expect(r.verdict).toBe("Bearish");
    expect(r.reason).toContain("Toxic");
  });

  it("is Bearish on reverse split + active facility", () => {
    const r = computeVerdict({
      ...base,
      has_reverse_split_12mo: true,
      instruments: [inst({ flags: ["active"] })],
    });
    expect(r.verdict).toBe("Bearish");
  });

  it("is Neutral when mixed (reverse split but no active facility)", () => {
    const r = computeVerdict({ ...base, has_reverse_split_12mo: true });
    expect(r.verdict).toBe("Neutral");
  });

  it("is Neutral when overhang unknown", () => {
    expect(computeVerdict({ ...base, overhang_pct: null }).verdict).toBe("Neutral");
  });
});
