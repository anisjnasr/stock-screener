import { describe, expect, it } from "vitest";
import { normalizeSslText } from "./formatting";

describe("normalizeSslText", () => {
  it("uppercases SSL keywords and functions without uppercasing user identifiers", () => {
    const input = "myVar = ma(Close, 20) and customField > atr(14);\nSORT_by = myRank asc;";

    expect(normalizeSslText(input)).toBe("myVar = MA(Close, 20) AND customField > ATR(14);\nSORT_BY = myRank ASC;");
  });

  it("preserves strings and comments", () => {
    const input = "name = 'small cap'; // use ma and atr later";

    expect(normalizeSslText(input)).toBe("name = 'small cap'; // use ma and atr later");
  });
});
