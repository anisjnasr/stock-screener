import { describe, expect, it } from "vitest";
import { formatEpsDollarPair, formatRevDollarPair, formatUsdCompact } from "./earnings-calendar-format";

describe("earnings-calendar-format", () => {
  it("formats compact USD revenue without useless decimals", () => {
    expect(formatUsdCompact(15_200_000_000)).toBe("$15.2B");
    expect(formatUsdCompact(256_000_000)).toBe("$256m");
    expect(formatUsdCompact(319_000_000)).toBe("$319m");
    expect(formatUsdCompact(400_150_000)).toBe("$400.15m");
    expect(formatUsdCompact(2_900_000_000)).toBe("$2.9B");
    expect(formatUsdCompact(7_560_000_000)).toBe("$7.56B");
    expect(formatUsdCompact(0)).toBe("$0");
  });

  it("formats rev and EPS pairs", () => {
    expect(formatRevDollarPair(10e6, 8e6)).toBe("$10m / $8m");
    expect(formatEpsDollarPair(1.35, 1)).toBe("$1.35 / $1.00");
    expect(formatRevDollarPair(null, null)).toBe("—");
    expect(formatEpsDollarPair(1.2, null)).toBe("$1.20 / —");
  });
});
