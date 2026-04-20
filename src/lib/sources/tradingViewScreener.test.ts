import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseTradingViewScanJson } from "./tradingViewScreener";

describe("parseTradingViewScanJson", () => {
  it("maps d[] columns to row fields", () => {
    const fixturePath = join(__dirname, "__fixtures__", "tradingview-scan-sample.json");
    const json = JSON.parse(readFileSync(fixturePath, "utf8"));
    const { rows, totalCount } = parseTradingViewScanJson(json);
    expect(totalCount).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].ticker).toBe("NKTR");
    expect(rows[0].gapPct).toBeCloseTo(14.718, 2);
    expect(rows[0].marketCap).toBeCloseTo(2993445571.56, 0);
    expect(rows[1].ticker).toBe("BLD");
    expect(rows[1].exchange).toBe("NYSE");
  });

  it("throws on TV error field", () => {
    expect(() => parseTradingViewScanJson({ error: "bad filter", data: null })).toThrow(/bad filter/);
  });
});
