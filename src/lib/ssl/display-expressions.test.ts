import { describe, it, expect } from "vitest";
import { parseScript } from "./parser";
import {
  collectDisplayExpressions,
  humanizeVarName,
  astToColumnHeader,
} from "./display-expressions";

describe("humanizeVarName", () => {
  it("maps GAIN_1M to Gain 1M", () => {
    expect(humanizeVarName("GAIN_1M")).toBe("Gain 1M");
  });
  it("keeps short all-caps tickers like RVOL", () => {
    expect(humanizeVarName("RVOL")).toBe("RVOL");
  });
});

describe("astToColumnHeader", () => {
  it("abbreviates MA(V, n)", () => {
    const ast = parseScript("X = MA(V, 21); C > 10;");
    const asg = ast.assignments[0];
    expect(asg).toBeDefined();
    expect(astToColumnHeader(asg!.expr)).toBe("MA V(21)");
  });
  it("abbreviates ROC(C, n)", () => {
    const ast = parseScript("X = ROC(C, 21); C > 10;");
    expect(astToColumnHeader(ast.assignments[0]!.expr)).toBe("ROC(21)");
  });
});

describe("collectDisplayExpressions", () => {
  it("orders filter columns before assignments (spec §12.2 example)", () => {
    const script = `
RVOL = V / MA(V, 20);
GAIN_1M = ROC(C, 21);
C > 10
AND MA(V, 20) >= 500000
AND RVOL >= 2;
TopN(GAIN_1M, 50);
`;
    const ast = parseScript(script);
    const cols = collectDisplayExpressions(ast);
    const keys = cols.map((c) => c.key);
    expect(keys[0]).toMatch(/MA\(V,\s*20\)/);
    expect(keys[1]).toBe("RVOL");
    expect(keys[2]).toBe("GAIN_1M");
    expect(keys).toHaveLength(3);
    expect(cols[1]?.header).toBe("RVOL");
    expect(cols[2]?.header).toBe("Gain 1M");
    expect(cols[2]?.format).toBe("pct");
  });

  it("dedupes TopN when sort expr is already a column", () => {
    const ast = parseScript(`
GAIN_1M = ROC(C, 21);
C > 10;
TopN(GAIN_1M, 50);
`);
    const cols = collectDisplayExpressions(ast);
    const keys = cols.map((c) => c.key);
    expect(keys.filter((k) => k === "GAIN_1M")).toHaveLength(1);
  });

  it("skips redundant price in filter", () => {
    const ast = parseScript("C >= 20 AND MA(V, 21)[1] >= 1000000 AND ATRP(21) >= 3;");
    const cols = collectDisplayExpressions(ast);
    const keys = cols.map((c) => c.key);
    expect(keys.some((k) => k === "C")).toBe(false);
    expect(keys.some((k) => k.includes("MA(V"))).toBe(true);
    expect(keys.some((k) => k.includes("ATRP"))).toBe(true);
  });

  it("uses stable keys for TopN without TopN prefix", () => {
    const ast = parseScript(`
C > 10;
TopN(ROC(C, 12), 5);
`);
    const cols = collectDisplayExpressions(ast);
    const roc = cols.find((c) => c.key.includes("ROC"));
    expect(roc).toBeDefined();
    expect(roc!.key.startsWith("TopN")).toBe(false);
    expect(roc!.header).toBe("ROC(12)");
  });
});
