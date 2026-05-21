import { describe, expect, it } from "vitest";
import {
  buildNarrativeBlocks,
  collectDigestLevelCatalog,
  formatDecisionLevelPrice,
  inferDecisionLevels,
  matchPriceToDigestSource,
  normalizeBulletField,
  splitProseIntoBullets,
  splitNarrativeIntoSections,
  textToBulletItems,
} from "@/lib/premarket/large-cap-narrative-display";

describe("textToBulletItems", () => {
  it("splits sentences into bullet items", () => {
    expect(
      textToBulletItems("Yesterday expanded range vs ATR. Price closed near prior day high.")
    ).toHaveLength(2);
  });
});

describe("formatDecisionLevelPrice", () => {
  it("formats single price and zones", () => {
    expect(formatDecisionLevelPrice({ role: "Trigger", source: "PDH", price: 420 })).toBe("$420.00");
    expect(
      formatDecisionLevelPrice({ role: "Range", source: "Consolidation", zone_low: 410, zone_high: 425 })
    ).toBe("$410.00 – $425.00");
  });
});

describe("inferDecisionLevels source resolution", () => {
  const digest = {
    key_levels: {
      prior_day_high: 420,
      prior_day_low: 415,
      recent_swing_high: 430,
    },
    multi_timescale_ranges: {
      short_sessions: 4,
      short: { high: 425, low: 410, tightness_range_vs_atr: 1.2 },
    },
  };

  it("matches scenario prices to digest structural levels", () => {
    const levels = inferDecisionLevels(
      {
        scenarios: [
          {
            rank: 1,
            key_levels: { trigger: 420, target: 430, invalidation: 415 },
          },
        ],
      },
      digest
    );
    expect(levels).toHaveLength(3);
    expect(levels[0]?.source).toBe("Prior day high");
    expect(levels[1]?.source).toBe("Recent swing high");
    expect(levels[2]?.source).toBe("Prior day low");
  });

  it("replaces generic decision_levels sources from digest", () => {
    const levels = inferDecisionLevels(
      {
        decision_levels: [{ role: "Trigger", source: "Primary scenario", price: 420 }],
      },
      digest
    );
    expect(levels[0]?.source).toBe("Prior day high");
  });

  it("catalog matches within tolerance", () => {
    const catalog = collectDigestLevelCatalog(digest);
    expect(matchPriceToDigestSource(420.01, catalog)).toBe("Prior day high");
  });
});

describe("buildNarrativeBlocks", () => {
  it("renders structured sections and three-column key levels", () => {
    const blocks = buildNarrativeBlocks(
      {
        narrative_sections: {
          big_picture: "Base structure.",
          recent_action: "Tight range.",
          historical_analogues: "Two precedents.",
          pre_market: "Gap up on volume.",
        },
        decision_levels: [
          { role: "Trigger", source: "Prior day high", price: 420 },
          { role: "Target", source: "Recent swing high", price: 430 },
          { role: "Invalidation", source: "Prior day low", price: 400 },
        ],
      },
      "historical_premarket"
    );

    expect(blocks.map((b) => b.title)).toEqual([
      "Big Picture",
      "Recent Action",
      "Pre-Market",
      "Key Levels",
    ]);
    expect(blocks.some((b) => b.title === "Historical Analogues")).toBe(false);
    const keyLevels = blocks.find((b) => b.kind === "levels");
    expect(keyLevels?.kind === "levels" && keyLevels.levels).toHaveLength(3);
    if (keyLevels?.kind === "levels") {
      expect(keyLevels.levels[0]).toEqual({
        role: "Trigger",
        source: "Prior day high",
        price: 420,
      });
    }
  });

  it("parses legacy labels into role and source columns", () => {
    const blocks = buildNarrativeBlocks(
      {
        decision_levels: [{ label: "Prior day high — breakout trigger if cleared", price: 420 }],
      },
      "historical"
    );
    const keyLevels = blocks.find((b) => b.kind === "levels");
    if (keyLevels?.kind !== "levels") throw new Error("expected key levels");
    expect(keyLevels.levels[0]?.role).toBe("Trigger");
    expect(keyLevels.levels[0]?.source).toBe("Prior day high");
  });

  it("splits legacy narrative into subsections using digest fallbacks", () => {
    const blocks = buildNarrativeBlocks(
      {
        narrative:
          "NVDA trades in a tight multi-month base. Yesterday's session showed range expansion. " +
          "Historical analogues show mixed follow-through. Pre-market gapped down on light volume.",
        scenarios: [
          {
            rank: 1,
            key_levels: { trigger: 420, target: 400, invalidation: 430 },
          },
        ],
      },
      "historical_premarket",
      {
        trend_and_momentum: { trend_label: "sideways" },
        multi_timescale_ranges: {
          short_sessions: 4,
          short: { high: 425, low: 410 },
        },
        historical_analogues: { match_count: 2, low_sample: true, summary_tendencies: {} },
      }
    );

    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const recent = blocks.find((b) => b.id === "recent_action");
    expect(recent?.kind).toBe("bullets");
    expect(blocks.some((b) => b.title === "Key Levels")).toBe(true);
  });

  it("omits pre-market section in historical-only mode", () => {
    const blocks = buildNarrativeBlocks(
      {
        narrative_sections: {
          big_picture: "A",
          recent_action: "B",
          historical_analogues: "C",
          pre_market: "Should hide",
        },
        decision_levels: [{ role: "Trigger", source: "PDH", price: 100 }],
      },
      "historical"
    );

    expect(blocks.some((b) => b.title === "Pre-Market")).toBe(false);
  });

  it("upgrades legacy cached verdicts to v2 layout with comps from digest", () => {
    const blocks = buildNarrativeBlocks(
      {
        narrative_sections: {
          big_picture: "Base structure.",
          recent_action: "Expanded 34 points (~7.9%), roughly 1.2x ATR.",
          historical_analogues: "329 matches with mixed follow-through.",
          pre_market: "Gap down on light volume.",
        },
        decision_levels: [{ role: "Trigger", source: "Prior day high", price: 98.43 }],
        scenarios: [{ rank: 1, key_levels: { trigger: 98.43, target: 105, invalidation: 96 } }],
      },
      "historical_premarket",
      {
        historical_analogues: {
          match_count: 329,
          low_sample: false,
          summary_tendencies: {
            follow_through_count: 155,
            reversed_count: 157,
            flat_or_chop_count: 17,
            avg_next_day_true_range_pct_of_open: 2.5,
          },
          examples: [],
        },
      }
    );

    expect(blocks.map((b) => b.title)).toEqual([
      "Big Picture",
      "Recent Action",
      "Pre-Market",
      "Comps (329)",
      "Key Levels",
    ]);
    expect(blocks.some((b) => b.title === "Historical Analogues")).toBe(false);
    const recent = blocks.find((b) => b.id === "recent_action");
    if (recent?.kind === "bullets") {
      expect(recent.items).toEqual(["Expanded 34 points (~7.9%), roughly 1.2x ATR."]);
    }
    const comps = blocks.find((b) => b.kind === "comps");
    expect(comps?.kind).toBe("comps");
  });

  it("delegates to v2 structured sections without prose splitting", () => {
    const blocks = buildNarrativeBlocks(
      {
        big_picture: "Memory cycle upturn.",
        recent_action: ["Prior day high held.", "Volume expanded."],
        pre_market: ["Gap up on volume."],
        key_levels: [{ role: "Trigger", source: "Prior day high", price: 98.4 }],
        comps: {
          total: 10,
          follow_through: 4,
          reversal: 5,
          flat: 1,
          low_sample: false,
          recent_examples: [],
        },
      },
      "historical_premarket"
    );

    expect(blocks.map((b) => b.title)).toEqual([
      "Big Picture",
      "Recent Action",
      "Pre-Market",
      "Comps (10)",
      "Key Levels",
    ]);
    const recent = blocks.find((b) => b.id === "recent_action");
    expect(recent?.kind).toBe("bullets");
    if (recent?.kind === "bullets") {
      expect(recent.items).toEqual(["Prior day high held.", "Volume expanded."]);
    }
    expect(blocks.some((b) => b.title === "Historical Analogues")).toBe(false);
    const comps = blocks.find((b) => b.kind === "comps");
    expect(comps?.kind).toBe("comps");
  });
});

describe("splitProseIntoBullets", () => {
  it("splits multi-sentence prose without breaking decimals", () => {
    const prose =
      "Pre-market last price is 263.945, a -0.40% gap versus the prior close of 265.01. " +
      "Price remains inside all range windows and has not cleared any structural level.";
    expect(splitProseIntoBullets(prose)).toHaveLength(2);
    expect(splitProseIntoBullets("Expanded 34 points (~7.9%), roughly 1.2x ATR.")).toEqual([
      "Expanded 34 points (~7.9%), roughly 1.2x ATR.",
    ]);
  });

  it("splits v2 arrays that contain one long bullet string", () => {
    const bullets = normalizeBulletField([
      "Yesterday was a strong session (+2.19%). the prior-session true range (2.35%) was just below one ATR.",
    ]);
    expect(bullets).toHaveLength(2);
    expect(bullets[1]?.startsWith("The")).toBe(true);
  });

  it("capitalizes bullets split from semicolons", () => {
    expect(
      normalizeBulletField(null, "First fact here. pre-market does not upgrade the read.")
    ).toEqual(["First fact here.", "Pre-market does not upgrade the read."]);
  });
});

describe("splitNarrativeIntoSections", () => {
  it("routes sentences into multiple sections", () => {
    const sections = splitNarrativeIntoSections(
      "Stock sits in a multi-month base with sideways trend. Yesterday expanded range vs ATR. " +
        "Three historical analogues followed through on gap-ups. Pre-market gapped up 1.2% on strong volume."
    );
    expect(sections.big_picture.length).toBeGreaterThan(0);
    expect(sections.recent_action.length).toBeGreaterThan(0);
    expect(sections.historical_analogues.length).toBeGreaterThan(0);
    expect(sections.pre_market.length).toBeGreaterThan(0);
  });
});
