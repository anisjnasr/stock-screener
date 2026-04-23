import { describe, expect, it } from "vitest";
import { parseSipCatalystRow } from "@/lib/ai/sipCatalyst";

const checksPass = {
  company_specific_news: true,
  surprises_market: true,
};

describe("parseSipCatalystRow", () => {
  it("parses SIP qualifier with two checks", () => {
    const r = parseSipCatalystRow({
      ticker: "nvda",
      checks: checksPass,
      qualifies_as_sip: true,
      catalyst_category: "partnership",
      catalyst_rationale: "Company-specific PR on a cloud partnership.",
      guidance_tone: "positive",
      confidence: "high",
      ranking_score: 8,
      catalyst_source_urls: ["https://example.com/a"],
      macro_aligned: true,
      macro_theme_tag: "Fed",
      industry_aligned: false,
      industry_theme_tag: null,
    });
    expect(r?.ticker).toBe("NVDA");
    expect(r?.catalyst.category).toBe("partnership");
    expect(r?.catalyst.summary).toContain("partnership");
    expect(r?.catalyst.guidance_tone).toBeNull();
    expect(r?.catalyst.confidence).toBe("high");
    expect(r?.catalyst.qualifies_as_sip).toBe(true);
    expect(r?.catalyst.checks).toEqual(checksPass);
    expect(r?.catalyst.ranking_score).toBe(8);
    expect(r?.catalyst.catalyst_source_urls).toEqual(["https://example.com/a"]);
  });

  it("maps legacy changes_story to company_specific_news", () => {
    const r = parseSipCatalystRow({
      ticker: "LEG",
      checks: { changes_story: true, surprises_market: true },
      qualifies_as_sip: true,
      catalyst_rationale: "ok",
      ranking_score: 5,
    });
    expect(r?.catalyst.checks.company_specific_news).toBe(true);
    expect(r?.catalyst.checks.surprises_market).toBe(true);
  });

  it("normalizes M&A style category", () => {
    const r = parseSipCatalystRow({
      ticker: "AAPL",
      checks: checksPass,
      qualifies_as_sip: true,
      category: "M&A",
      catalyst_rationale: "Reported acquisition talks.",
      ranking_score: 6,
    });
    expect(r?.catalyst.category).toBe("m_and_a");
  });

  it("keeps guidance_tone for earnings", () => {
    const r = parseSipCatalystRow({
      ticker: "XYZ",
      checks: checksPass,
      qualifies_as_sip: true,
      catalyst_category: "earnings",
      catalyst_rationale: "Beat on revenue.",
      guidance_tone: "positive",
      confidence: "medium",
      ranking_score: 7,
    });
    expect(r?.catalyst.guidance_tone).toBe("positive");
  });

  it("returns null when company_specific_news is false", () => {
    expect(
      parseSipCatalystRow({
        ticker: "X",
        checks: { company_specific_news: false, surprises_market: true },
        qualifies_as_sip: true,
        catalyst_rationale: "Story",
        ranking_score: 9,
      })
    ).toBeNull();
  });

  it("returns null when surprises_market is false", () => {
    expect(
      parseSipCatalystRow({
        ticker: "X",
        checks: { company_specific_news: true, surprises_market: false },
        qualifies_as_sip: true,
        catalyst_rationale: "Story",
        ranking_score: 9,
      })
    ).toBeNull();
  });

  it("returns null without ticker or rationale", () => {
    expect(parseSipCatalystRow({ checks: checksPass, catalyst_category: "earnings", catalyst_rationale: "x" })).toBeNull();
    expect(
      parseSipCatalystRow({
        ticker: "X",
        checks: checksPass,
        qualifies_as_sip: true,
        catalyst_category: "earnings",
        catalyst_rationale: "",
        ranking_score: 5,
      })
    ).toBeNull();
  });

  it("clamps ranking_score", () => {
    const hi = parseSipCatalystRow({
      ticker: "Z",
      checks: checksPass,
      qualifies_as_sip: true,
      catalyst_rationale: "ok",
      ranking_score: 99,
    });
    expect(hi?.catalyst.ranking_score).toBe(10);
  });
});
