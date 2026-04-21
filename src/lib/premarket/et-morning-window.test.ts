import { describe, expect, it } from "vitest";
import { etMorningNewsletterWindow } from "./et-morning-window";

describe("etMorningNewsletterWindow", () => {
  it("returns UTC ISO bounds for an ET calendar day", () => {
    const { startUtcIso, endUtcIso } = etMorningNewsletterWindow("2026-06-15");
    expect(startUtcIso < endUtcIso).toBe(true);
    expect(startUtcIso).toMatch(/T08:00:00/); // 4am EDT = 08:00 UTC
    expect(endUtcIso).toMatch(/T11:00:00/); // 7am EDT = 11:00 UTC
  });
});
