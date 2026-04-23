import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  parseFfAmericanDateToIso,
  parseFfTimeToHmsEt,
  parseForexFactoryHighMediumImpactUsd,
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

describe("parseForexFactoryHighMediumImpactUsd", () => {
  it("keeps USD High and Medium events only", () => {
    const fixturePath = join(__dirname, "__fixtures__", "forex-factory-sample.xml");
    const xml = readFileSync(fixturePath, "utf8");
    const rows = parseForexFactoryHighMediumImpactUsd(xml);
    expect(rows).toHaveLength(2);
    const nfp = rows.find((r) => r.event_name === "Non-Farm Payrolls");
    const pmi = rows.find((r) => r.event_name === "ISM Manufacturing PMI");
    expect(nfp).toBeDefined();
    expect(nfp!.country).toBe("US");
    expect(nfp!.impact).toBe("High");
    expect(nfp!.event_date).toBe("2026-04-20");
    expect(nfp!.event_time_et).toBe("08:30:00");
    expect(nfp!.forecast).toBe("180K");
    expect(nfp!.previous).toBe("175K");
    expect(nfp!.source).toBe("forex_factory");
    expect(nfp!.actual).toBeUndefined();
    expect(nfp!.external_id).toMatch(/^ff:2026-04-20:/);
    expect(pmi).toBeDefined();
    expect(pmi!.impact).toBe("Medium");
    expect(pmi!.event_time_et).toBe("10:00:00");
    expect(pmi!.forecast).toBe("50.1");
    expect(pmi!.previous).toBe("49.5");
  });
});
