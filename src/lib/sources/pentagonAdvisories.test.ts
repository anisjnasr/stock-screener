import { describe, expect, it } from "vitest";
import { parsePentagonAdvisoriesRss } from "./pentagonAdvisories";

describe("parsePentagonAdvisoriesRss", () => {
  it("extracts Pentagon press conference advisories with ET time", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Secretary of Defense Press Conference</title>
      <link>https://www.defense.gov/News/Advisories/Advisory/Article/123/example/</link>
      <pubDate>Tue, 05 May 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[Secretary Hegseth and Gen. Caine hold a press conference at 8 a.m. EDT at the Pentagon.]]></description>
    </item>
    <item>
      <title>Contracts Daily</title>
      <link>https://www.defense.gov/News/Contracts/Contract/Article/999/example/</link>
      <pubDate>Tue, 05 May 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[This is not a media event.]]></description>
    </item>
  </channel>
</rss>`;
    const rows = parsePentagonAdvisoriesRss(xml);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_category).toBe("pentagon_press");
    expect(rows[0].event_time_et).toBe("08:00:00");
    expect(rows[0].event_title).toMatch(/Press Conference/i);
    expect(rows[0].source_type).toBe("pentagon_advisories_rss");
  });
});
