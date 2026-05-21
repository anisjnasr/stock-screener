import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CompsSection from "@/components/premarket/CompsSection";
import {
  compsCategories,
  formatCompsExampleOutcome,
  type CompsDisplay,
} from "@/lib/premarket/large-cap-verdict-display";

function makeComps(overrides: Partial<CompsDisplay> = {}): CompsDisplay {
  return {
    total: 16,
    follow_through: 8,
    reversal: 8,
    flat: 0,
    avg_next_day_range_pct: 2.4,
    avg_follow_through_pct: 1.8,
    avg_reversal_pct: 2.1,
    low_sample: true,
    recent_examples: [
      {
        date: "2026-01-16",
        comp_gap_pct: -2.48,
        outcome: "reversal",
        outcome_pct: 2.58,
      },
    ],
    ...overrides,
  };
}

describe("formatCompsExampleOutcome", () => {
  it("combines outcome verb and signed pct", () => {
    expect(formatCompsExampleOutcome("reversal", 2.58)).toBe("Reversed +2.58%");
    expect(formatCompsExampleOutcome("follow_through", -1.2)).toBe("Followed Through -1.2%");
    expect(formatCompsExampleOutcome("flat", 0)).toBe("Flat 0%");
  });
});

describe("compsCategories", () => {
  it("always returns all three categories with counts", () => {
    expect(compsCategories(makeComps())).toEqual([
      { key: "follow_through", label: "Follow-through", count: 8 },
      { key: "reversal", label: "Reversal", count: 8 },
      { key: "flat", label: "Flat", count: 0 },
    ]);
  });
});

describe("CompsSection render", () => {
  it("renders total=16 at full opacity with all category labels", () => {
    const html = renderToStaticMarkup(<CompsSection comps={makeComps()} />);

    expect(html).not.toContain("lc-comps--low-sample");
    expect(html).toContain("Follow-through");
    expect(html).toContain("Reversal");
    expect(html).toContain("Flat");
    expect(html).toContain("8/16");
    expect(html).toContain("0/16");
    expect(html).not.toContain('lc-comps-bar-segment--flat');
    expect(html).toContain("2026-01-16");
    expect(html).toContain("-2.48%");
    expect(html).toContain("Reversed +2.58%");
    expect(html).toContain("Date");
    expect(html).toContain("Gap");
    expect(html).toContain("Outcome");
    expect(html).toContain("rgba(74,222,128,0.35)");
  });

  it("renders total>=20 with flat bar segment at full opacity", () => {
    const html = renderToStaticMarkup(
      <CompsSection
        comps={makeComps({
          total: 24,
          follow_through: 10,
          reversal: 12,
          flat: 2,
          low_sample: false,
        })}
      />
    );

    expect(html).not.toContain("lc-comps--low-sample");
    expect(html).toContain("10/24");
    expect(html).toContain("12/24");
    expect(html).toContain("2/24");
    expect(html).toContain("lc-comps-bar-segment--flat");
    expect(html).toContain("rgba(74,222,128,0.35)");
  });
});
