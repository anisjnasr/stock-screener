import { describe, expect, it } from "vitest";
import {
  buildVerdictSections,
  compsSegmentWidths,
  capitalizeBulletStart,
  formatKeyLevelPrice,
  formatMonoPrice,
  formatScenarioLevelsLine,
  formatSignedPct,
  formatCompsExampleOutcome,
  compsCategories,
  formatCompsSectionTitle,
  isV2Verdict,
  outcomeLabel,
  scenarioLetter,
  type CompsDisplay,
} from "@/lib/premarket/large-cap-verdict-display";

const sampleV2Verdict: Record<string, unknown> = {
  ticker: "MU",
  verdict: "Trade",
  big_picture: "Memory cycle upturn.",
  recent_action: ["Prior day high held.", "Volume expanded."],
  pre_market: ["Gap up 1.2% on strong PM volume."],
  key_levels: [{ role: "Trigger", source: "Prior day high", price: 98.4 }],
  scenarios: [
    {
      label: "A",
      direction: "Long",
      confidence: "High",
      title: "Breakout continuation",
      trigger: 98.4,
      target: 102.5,
      stop: 96.1,
    },
  ],
  comps: {
    total: 329,
    follow_through: 155,
    reversal: 157,
    flat: 17,
    low_sample: false,
    recent_examples: [
      {
        date: "2024-01-15",
        comp_gap_pct: 1.2,
        outcome: "follow_through",
        outcome_pct: 2.1,
      },
    ],
  },
};

describe("isV2Verdict", () => {
  it("detects v2 by big_picture string", () => {
    expect(isV2Verdict({ big_picture: "Context." })).toBe(true);
  });

  it("detects v2 by recent_action array", () => {
    expect(isV2Verdict({ recent_action: ["Line one."] })).toBe(true);
  });

  it("returns false for legacy-only verdicts", () => {
    expect(isV2Verdict({ narrative: "Single blob.", verdict: "Trade" })).toBe(false);
    expect(isV2Verdict(undefined)).toBe(false);
  });
});

describe("buildVerdictSections", () => {
  it("orders v2 sections: Big Picture → Recent Action → Pre-Market → Comps → Key Levels", () => {
    const sections = buildVerdictSections(sampleV2Verdict, "historical_premarket");
    expect(sections.map((s) => s.title)).toEqual([
      "Big Picture",
      "Recent Action",
      "Pre-Market",
      "Comps (329)",
      "Key Levels",
    ]);
    expect(sections.some((s) => s.title === "Historical Analogues")).toBe(false);
  });

  it("omits Pre-Market in historical-only mode", () => {
    const sections = buildVerdictSections(sampleV2Verdict, "historical");
    expect(sections.map((s) => s.title)).toEqual([
      "Big Picture",
      "Recent Action",
      "Comps (329)",
      "Key Levels",
    ]);
  });

  it("renders comps block with parsed stats", () => {
    const sections = buildVerdictSections(sampleV2Verdict, "historical");
    const comps = sections.find((s) => s.kind === "comps");
    expect(comps?.kind).toBe("comps");
    if (comps?.kind === "comps") {
      expect(comps.comps.total).toBe(329);
      expect(comps.comps.follow_through).toBe(155);
      expect(comps.comps.recent_examples).toHaveLength(1);
      expect(comps.comps.recent_examples[0]?.outcome).toBe("follow_through");
    }
  });

  it("returns empty for non-v2 verdicts", () => {
    expect(buildVerdictSections({ narrative: "Legacy." }, "historical")).toEqual([]);
  });
});

describe("formatScenarioLevelsLine", () => {
  it("formats trigger, target, and stop", () => {
    expect(
      formatScenarioLevelsLine({ trigger: 98.4, target: 102.5, stop: 96.1 })
    ).toBe("Trigger 98.40 · Target 102.50 · Stop 96.10");
  });

  it("formats range with break levels", () => {
    expect(formatScenarioLevelsLine({ range: [96.1, 98.4] })).toBe(
      "Range 96.10 – 98.40 · Break 98.40 / 96.10"
    );
  });

  it("reads legacy nested key_levels on scenarios", () => {
    expect(
      formatScenarioLevelsLine({ key_levels: { trigger: 98.43, target: 105, invalidation: 96 } })
    ).toBe("Trigger 98.43 · Target 105.00 · Stop 96.00");
  });

  it("returns empty string when no levels present", () => {
    expect(formatScenarioLevelsLine({})).toBe("");
  });
});

describe("compsSegmentWidths", () => {
  const comps: CompsDisplay = {
    total: 329,
    follow_through: 155,
    reversal: 157,
    flat: 17,
    avg_next_day_range_pct: 2.5,
    avg_follow_through_pct: 1.8,
    avg_reversal_pct: -1.2,
    low_sample: false,
    recent_examples: [],
  };

  it("computes segment percentages from counts", () => {
    const { followPct, reversalPct, flatPct } = compsSegmentWidths(comps);
    expect(followPct).toBeCloseTo((155 / 329) * 100, 5);
    expect(reversalPct).toBeCloseTo((157 / 329) * 100, 5);
    expect(followPct + reversalPct + flatPct).toBeCloseTo(100, 5);
  });

  it("returns flat 100% when total is zero", () => {
    expect(compsSegmentWidths({ ...comps, total: 0 })).toEqual({
      followPct: 0,
      reversalPct: 0,
      flatPct: 100,
    });
  });
});

describe("formatKeyLevelPrice", () => {
  it("formats single price and range", () => {
    expect(formatKeyLevelPrice({ role: "Trigger", source: "PDH", price: 98.4 })).toBe("98.40");
    expect(
      formatKeyLevelPrice({ role: "Range", source: "Zone", range: [100, 95] })
    ).toBe("95.00 – 100.00");
  });
});

describe("scenarioLetter", () => {
  it("uses label when A/B/C", () => {
    expect(scenarioLetter({ label: "B" }, 0)).toBe("B");
  });

  it("falls back to index letter", () => {
    expect(scenarioLetter({}, 1)).toBe("B");
  });
});

describe("capitalizeBulletStart", () => {
  it("capitalizes the first letter of each bullet", () => {
    expect(capitalizeBulletStart("pre-market does not upgrade the read.")).toBe(
      "Pre-market does not upgrade the read."
    );
    expect(capitalizeBulletStart("  gap down on light volume.")).toBe("Gap down on light volume.");
  });
});

describe("formatMonoPrice, formatSignedPct, and outcomeLabel", () => {
  it("formats finite numbers and dashes otherwise", () => {
    expect(formatMonoPrice(12.345)).toBe("12.35");
    expect(formatMonoPrice("x")).toBe("—");
  });

  it("formats signed percentages", () => {
    expect(formatSignedPct(1.15)).toBe("+1.15%");
    expect(formatSignedPct(-0.4)).toBe("-0.4%");
    expect(formatSignedPct(0.22)).toBe("+0.22%");
    expect(formatSignedPct(-5.2)).toBe("-5.2%");
  });

  it("maps outcome codes to title-case labels", () => {
    expect(outcomeLabel("follow_through")).toBe("Followed Through");
    expect(outcomeLabel("reversal")).toBe("Reversed");
    expect(outcomeLabel("flat")).toBe("Flat");
  });

  it("formats comps section title with total count", () => {
    expect(formatCompsSectionTitle(16)).toBe("Comps (16)");
    expect(formatCompsSectionTitle(329)).toBe("Comps (329)");
  });

  it("formats comps example outcome cells", () => {
    expect(formatCompsExampleOutcome("reversal", 2.58)).toBe("Reversed +2.58%");
  });

  it("lists all comps categories including zero flat", () => {
    const cats = compsCategories({
      total: 16,
      follow_through: 8,
      reversal: 8,
      flat: 0,
      avg_next_day_range_pct: 0,
      avg_follow_through_pct: 0,
      avg_reversal_pct: 0,
      low_sample: true,
      recent_examples: [],
    });
    expect(cats.map((c) => c.label)).toEqual(["Follow-through", "Reversal", "Flat"]);
    expect(cats.find((c) => c.key === "flat")?.count).toBe(0);
  });
});
