import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseFedMonthlyCalendarHtml } from "./fedCalendar";

describe("parseFedMonthlyCalendarHtml", () => {
  it("parses FOMC and speech rows from monthly HTML", () => {
    const fixturePath = join(__dirname, "__fixtures__", "fed-month-sample.html");
    const html = readFileSync(fixturePath, "utf8");
    const rows = parseFedMonthlyCalendarHtml(html);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const fomc = rows.find((r) => r.event_category === "fomc");
    expect(fomc?.event_date).toBe("2026-04-30");
    expect(fomc?.event_time_et).toBe("14:00:00");
    expect(fomc?.event_title).toContain("FOMC Minutes");
    expect(fomc?.impact).toBe("High");

    const speech = rows.find((r) => r.event_category === "fed_speech" && r.event_date === "2026-04-21");
    expect(speech?.event_time_et).toBe("10:00:00");
    expect(speech?.speaker).toMatch(/Governor/);
  });
});
