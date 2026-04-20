import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  parseFfAmericanDateToIso,
  parseFfTimeToHmsEt,
  parseForexFactoryHighImpactUsd,
} from "./forexFactoryCalendar";

describe("parseFfAmericanDateToIso", () => {
  it("converts MM-DD-YYYY to ISO date", () => {
    expect(parseFfAmericanDateToIso("04-20-2026")).toBe("2026-04-20");
    expect(parseFfAmericanDateToIso("01-05-2026")).toBe("2026-01-05");
    expect(parseFfAmericanDateToIso("13-40-2026")).toBe(null);
    expect(parseFfAmericanDateToIso("bad")).toBe(null);
  });
});

describe("parseFfTimeToHmsEt", () => {
  it("parses am/pm times", () => {
    expect(parseFfTimeToHmsEt("8:30am")).toBe("08:30:00");
    expect(parseFfTimeToHmsEt("12:15pm")).toBe("12:15:00");
    expect(parseFfTimeToHmsEt("12:00am")).toBe("00:00:00");
    expect(parseFfTimeToHmsEt("12:00pm")).toBe("12:00:00");
  });

  it("returns null for tentative / empty", () => {
    expect(parseFfTimeToHmsEt("Tentative")).toBe(null);
    expect(parseFfTimeToHmsEt("")).toBe(null);
  });
});

describe("parseForexFactoryHighImpactUsd", () => {
  it("keeps only USD High events", () => {
    const fixturePath = join(__dirname, "__fixtures__", "forex-factory-sample.xml");
    const xml = readFileSync(fixturePath, "utf8");
    const rows = parseForexFactoryHighImpactUsd(xml);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe("Non-Farm Payrolls");
    expect(rows[0].country).toBe("US");
    expect(rows[0].impact).toBe("High");
    expect(rows[0].event_date).toBe("2026-04-20");
    expect(rows[0].event_time_et).toBe("08:30:00");
    expect(rows[0].forecast).toBe("180K");
    expect(rows[0].previous).toBe("175K");
    expect(rows[0].source).toBe("forex_factory");
    expect(rows[0].actual).toBe(null);
    expect(rows[0].external_id).toMatch(/^ff:2026-04-20:/);
  });
});
