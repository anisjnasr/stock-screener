import { describe, expect, it } from "vitest";
import {
  buildReferenceDateContext,
  formatPartialReferenceDateInput,
  formatReferenceDateDisplay,
  isSelectableReferenceDate,
  parseReferenceDateInput,
  referenceDateInputCaret,
  referenceDateInvalidReason,
} from "@/lib/complab/reference-dates";
import type { CompLabCandle } from "@/lib/complab/chart-series";

const candles: CompLabCandle[] = [
  { date: "2024-03-13", open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { date: "2024-03-14", open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { date: "2024-03-15", open: 1, high: 1, low: 1, close: 1, volume: 1 },
];

describe("reference-dates", () => {
  it("formats and parses dd-mm-yyyy", () => {
    expect(formatReferenceDateDisplay("2024-03-15")).toBe("15-03-2024");
    expect(parseReferenceDateInput("15-03-2024")).toBe("2024-03-15");
  });

  it("builds partial dd-mm-yyyy input with caret positions", () => {
    expect(formatPartialReferenceDateInput("1")).toBe("1");
    expect(referenceDateInputCaret(1)).toBe(1);
    expect(formatPartialReferenceDateInput("15")).toBe("15-");
    expect(referenceDateInputCaret(2)).toBe(3);
    expect(formatPartialReferenceDateInput("1503")).toBe("15-03-");
    expect(referenceDateInputCaret(4)).toBe(6);
    expect(formatPartialReferenceDateInput("15032024")).toBe("15-03-2024");
    expect(referenceDateInputCaret(8)).toBe(10);
  });

  it("marks weekends and today/future invalid", () => {
    const ctx = buildReferenceDateContext(candles, "2024-03-16");
    expect(isSelectableReferenceDate("2024-03-15", ctx)).toBe(true);
    expect(isSelectableReferenceDate("2024-03-16", ctx)).toBe(false);
    expect(referenceDateInvalidReason("2024-03-16", ctx)).toMatch(/Today and future/);

    const ctxLater = buildReferenceDateContext(candles, "2024-03-20");
    expect(referenceDateInvalidReason("2024-03-17", ctxLater)).toMatch(/Weekends/);
  });

  it("requires a bar on the date (market holidays)", () => {
    const ctx = buildReferenceDateContext(candles, "2024-03-20");
    expect(referenceDateInvalidReason("2024-03-18", ctx)).toMatch(/No market session/);
  });
});
