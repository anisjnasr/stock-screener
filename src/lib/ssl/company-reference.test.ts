import { describe, expect, it } from "vitest";
import { parseScript } from "./parser";
import { evaluateScript, type EvalContext } from "./interpreter";

const stubBar = { date: "2026-04-15", open: 1, high: 1, low: 1, close: 1, volume: 1 };

function ctxWithCompanyReference(): EvalContext {
  return {
    bars: [stubBar],
    variables: {},
    symbol: "AGIO",
    snapshot: {
      ipo_date: "2013-07-24",
      days_since_ipo: 4649,
      sector: "Healthcare",
      industry: "Biotechnology",
    },
  };
}

describe("SSL company reference fields", () => {
  it("reads IPO_DATE / IPODATE from the SSL snapshot for comparisons", () => {
    const ctx = ctxWithCompanyReference();

    expect(evaluateScript(parseScript("IPO_DATE == \"2013-07-24\";"), ctx)).toBe(true);
    expect(evaluateScript(parseScript("IPODATE == \"2013-07-24\";"), ctx)).toBe(true);
  });

  it("supports IPO date comparisons and DAYS_SINCE_IPO", () => {
    const ctx = ctxWithCompanyReference();

    expect(evaluateScript(parseScript("IPO_DATE < \"2020-01-01\";"), ctx)).toBe(true);
    expect(evaluateScript(parseScript("DAYS_SINCE_IPO > 1000;"), ctx)).toBe(true);
  });

  it("reads sector and industry company reference strings", () => {
    const ctx = ctxWithCompanyReference();

    expect(evaluateScript(parseScript("SECTOR == \"Healthcare\";"), ctx)).toBe(true);
    expect(evaluateScript(parseScript("INDUSTRY == \"Biotechnology\";"), ctx)).toBe(true);
  });
});
