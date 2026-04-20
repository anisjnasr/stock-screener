import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseWhiteHousePostsSitemapXml } from "./whiteHouseSitemap";

describe("parseWhiteHousePostsSitemapXml", () => {
  it("parses briefing-room URLs from WP sitemap sample", () => {
    const fixturePath = join(__dirname, "__fixtures__", "whitehouse-sitemap-sample.xml");
    const xml = readFileSync(fixturePath, "utf8");
    const rows = parseWhiteHousePostsSitemapXml(xml, { maxDaysBack: 365 });
    expect(rows).toHaveLength(1);
    expect(rows[0].event_category).toBe("white_house");
    expect(rows[0].event_date).toBe("2026-04-10");
    expect(rows[0].source_url).toContain("briefing-room");
    expect(rows[0].external_id).toMatch(/^wh:/);
  });
});
