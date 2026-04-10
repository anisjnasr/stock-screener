import { describe, it, expect } from "vitest";
import { parseScript } from "./parser";
import { evaluateExpression, evaluateScript, type EvalContext } from "./interpreter";
import type { SslFinancialSeries } from "@/lib/screener-db-native";

const stubBar = { date: "2024-04-01", open: 1, high: 1, low: 1, close: 1, volume: 1 };

function ctxWithFundamentals(fundamentals: SslFinancialSeries): EvalContext {
  return {
    bars: [stubBar],
    variables: {},
    symbol: "T",
    fundamentals,
  };
}

describe("SSL fundamentals", () => {
  const quarterly: SslFinancialSeries["quarterly"] = [
    { period_end: "2024-03-31", eps: 1.0, eps_growth_yoy: 10, sales: 100, sales_growth_yoy: 5 },
    { period_end: "2023-12-31", eps: 0.9, eps_growth_yoy: 20, sales: 90, sales_growth_yoy: 8 },
    { period_end: "2023-09-30", eps: 0.8, eps_growth_yoy: 30, sales: 80, sales_growth_yoy: 12 },
  ];
  const annual: SslFinancialSeries["annual"] = [
    { period_end: "2023-12-31", eps: 3.5, eps_growth_yoy: 15, sales: 400, sales_growth_yoy: 7 },
    { period_end: "2022-12-31", eps: 3.0, eps_growth_yoy: 10, sales: 350, sales_growth_yoy: 4 },
  ];
  const fund: SslFinancialSeries = { quarterly, annual };

  it("Q reads newest-first quarter and REVENUE maps to sales", () => {
    const ast = parseScript("Q(EPS_GROWTH_YOY, 0);");
    const ctx = ctxWithFundamentals(fund);
    expect(evaluateExpression(ast.filter, ctx)).toBe(10);
    const ast2 = parseScript("Q(REVENUE, 1);");
    expect(evaluateExpression(ast2.filter, ctx)).toBe(90);
  });

  it("Q(field, n)[k] adds period shift like Q(field, n+k)", () => {
    const ctx = ctxWithFundamentals(fund);
    const direct = parseScript("Q(EPS_GROWTH_YOY, 1);");
    const bracketed = parseScript("Q(EPS_GROWTH_YOY, 0)[1];");
    expect(evaluateExpression(direct.filter, ctx)).toBe(20);
    expect(evaluateExpression(bracketed.filter, ctx)).toBe(20);
  });

  it("nested period lookbacks stack", () => {
    const ctx = ctxWithFundamentals(fund);
    const ast = parseScript("Q(EPS_GROWTH_YOY, 0)[1][1];");
    expect(evaluateExpression(ast.filter, ctx)).toBe(30);
  });

  it("AVG_Q averages count consecutive quarters from optional [s]", () => {
    const ctx = ctxWithFundamentals(fund);
    const ast = parseScript("AVG_Q(EPS, 3);");
    expect(evaluateExpression(ast.filter, ctx)).toBeCloseTo((1.0 + 0.9 + 0.8) / 3);
    const astShift = parseScript("AVG_Q(EPS, 2)[1];");
    expect(evaluateExpression(astShift.filter, ctx)).toBeCloseTo((0.9 + 0.8) / 2);
  });

  it("A uses annual series", () => {
    const ctx = ctxWithFundamentals(fund);
    const ast = parseScript("A(EPS_ANNUAL, 0);");
    expect(evaluateExpression(ast.filter, ctx)).toBe(3.5);
  });

  it("filter passes when fundamental compares true", () => {
    const ast = parseScript("Q(EPS_GROWTH_YOY, 0) > 5;");
    expect(evaluateScript(ast, ctxWithFundamentals(fund))).toBe(true);
  });

  it("MA on bare EPS is invalid (null)", () => {
    const ast = parseScript("MA(EPS, 5) > 0;");
    expect(evaluateScript(ast, ctxWithFundamentals(fund))).toBe(false);
  });

  it("without fundamentals, Q returns null / filter fails", () => {
    const ast = parseScript("Q(EPS, 0) > 0;");
    const ctx: EvalContext = { bars: [stubBar], variables: {}, symbol: "T" };
    expect(evaluateScript(ast, ctx)).toBe(false);
  });
});
