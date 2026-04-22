import { describe, expect, it } from "vitest";
import { parseSipCatalystRow } from "@/lib/ai/sipCatalyst";

describe("parseSipCatalystRow", () => {
  it("parses valid row and strips guidance for non-earnings category", () => {
    const r = parseSipCatalystRow({
      ticker: "nvda",
      category: "partnership",
      summary: "Chip vendor announced a cloud deal.",
      guidance_tone: "positive",
      confidence: "high",
    });
    expect(r?.ticker).toBe("NVDA");
    expect(r?.catalyst.category).toBe("partnership");
    expect(r?.catalyst.guidance_tone).toBeNull();
    expect(r?.catalyst.confidence).toBe("high");
  });

  it("normalizes M&A style category and nulls guidance for m_and_a", () => {
    const r = parseSipCatalystRow({
      ticker: "AAPL",
      category: "M&A",
      summary: "Reported acquisition talks.",
      guidance_tone: "neutral",
      confidence: "low",
    });
    expect(r?.catalyst.category).toBe("m_and_a");
    expect(r?.catalyst.guidance_tone).toBeNull();
  });

  it("keeps guidance_tone for earnings", () => {
    const r = parseSipCatalystRow({
      ticker: "XYZ",
      category: "earnings",
      summary: "Beat on revenue.",
      guidance_tone: "positive",
      confidence: "medium",
    });
    expect(r?.catalyst.guidance_tone).toBe("positive");
  });

  it("returns null without ticker or summary", () => {
    expect(parseSipCatalystRow({ category: "earnings", summary: "x" })).toBeNull();
    expect(parseSipCatalystRow({ ticker: "X", summary: "" })).toBeNull();
  });
});
