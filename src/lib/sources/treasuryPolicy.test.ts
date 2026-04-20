import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseTreasuryAnnouncedJson, parseTreasuryPressListingHtml } from "./treasuryPolicy";

describe("parseTreasuryAnnouncedJson", () => {
  it("maps announced securities to auction rows", () => {
    const json = JSON.stringify([
      {
        cusip: "9128285X9",
        securityType: "Note",
        securityTerm: "10-Year",
        auctionDate: "2026-04-22T00:00:00",
        closingTimeCompetitive: "1:00 PM",
      },
    ]);
    const rows = parseTreasuryAnnouncedJson(json);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_date).toBe("2026-04-22");
    expect(rows[0].event_category).toBe("treasury_auction");
    expect(rows[0].impact).toBe("High");
    expect(rows[0].event_time_et).toBe("13:00:00");
    expect(rows[0].external_id).toContain("9128285X9");
  });
});

describe("parseTreasuryPressListingHtml", () => {
  it("pairs time elements with keyworded press titles", () => {
    const fixturePath = join(__dirname, "__fixtures__", "treasury-press-sample.html");
    const html = readFileSync(fixturePath, "utf8");
    const rows = parseTreasuryPressListingHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_category).toBe("treasury_press");
    expect(rows[0].event_date).toBe("2026-04-15");
    expect(rows[0].event_title).toMatch(/Section 301/);
    expect(rows[0].source_url).toContain("home.treasury.gov");
  });
});
