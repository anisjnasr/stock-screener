import { describe, expect, it } from "vitest";
import { isSipVolumeCandidate, SIP_MIN_ABS_GAP_PCT, SIP_MIN_PM_VOLUME, SIP_MIN_PM_VOL_FRAC_OF_ADV } from "./sip-candidate-filter";

describe("isSipVolumeCandidate", () => {
  it("accepts typical passing row", () => {
    expect(
      isSipVolumeCandidate({
        gapPct: 3,
        pmVolume: 500_000,
        avgVolume90d: 1_000_000,
      })
    ).toBe(true);
  });

  it("rejects |gap| under threshold", () => {
    expect(isSipVolumeCandidate({ gapPct: 1.5, pmVolume: 500_000, avgVolume90d: 1_000_000 })).toBe(false);
    expect(isSipVolumeCandidate({ gapPct: -1.5, pmVolume: 500_000, avgVolume90d: 1_000_000 })).toBe(false);
  });

  it("rejects PM volume under 100k", () => {
    expect(isSipVolumeCandidate({ gapPct: 5, pmVolume: 99_999, avgVolume90d: 1_000_000 })).toBe(false);
  });

  it("rejects PM vol under 20% of ADV", () => {
    expect(isSipVolumeCandidate({ gapPct: 5, pmVolume: 100_000, avgVolume90d: 1_000_000 })).toBe(false);
    expect(isSipVolumeCandidate({ gapPct: 5, pmVolume: 200_000, avgVolume90d: 1_000_000 })).toBe(true);
  });

  it("rejects missing ADV", () => {
    expect(isSipVolumeCandidate({ gapPct: 5, pmVolume: 500_000, avgVolume90d: null })).toBe(false);
  });

  it("exports constants for route/docs parity", () => {
    expect(SIP_MIN_ABS_GAP_PCT).toBe(2);
    expect(SIP_MIN_PM_VOLUME).toBe(100_000);
    expect(SIP_MIN_PM_VOL_FRAC_OF_ADV).toBe(0.2);
  });
});
