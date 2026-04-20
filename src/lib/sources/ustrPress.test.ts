import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseUstrPressListingHtml, parseUstrPressPathDate } from "./ustrPress";

describe("parseUstrPressPathDate", () => {
  it("maps year and month slug to first-of-month YMD", () => {
    expect(parseUstrPressPathDate("/press-releases/2026/april/foo")).toBe("2026-04-01");
    expect(parseUstrPressPathDate("/other/path")).toBe(null);
  });
});

describe("parseUstrPressListingHtml", () => {
  it("keeps trade-related USTR rows with external ids", () => {
    const fixturePath = join(__dirname, "__fixtures__", "ustr-press-sample.html");
    const html = readFileSync(fixturePath, "utf8");
    const rows = parseUstrPressListingHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_category).toBe("ustr");
    expect(rows[0].event_date).toBe("2026-04-01");
    expect(rows[0].source_url).toContain("ustr.gov");
    expect(rows[0].external_id).toMatch(/^ustr:/);
  });
});
