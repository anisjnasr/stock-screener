import { describe, it, expect } from "vitest";
import { extractUserVariableNames, filterCompletions, getStaticCompletions } from "./completions";

describe("completions", () => {
  it("extractUserVariableNames skips reserved", () => {
    const script = `
MA50 = MA(C, 50);
RVOL = V / MA(V, 20);
C > 10;
`;
    const names = extractUserVariableNames(script);
    expect(names).toContain("MA50");
    expect(names).toContain("RVOL");
    expect(names).not.toContain("MA");
  });

  it("filterCompletions puts matching user vars before builtins", () => {
    const script = "MYVOL = V;\nMY";
    const list = filterCompletions(script, "MY");
    expect(list[0]?.kind).toBe("user");
    expect(list[0]?.label).toBe("MYVOL");
    expect(list.some((x) => x.label === "MY")).toBe(false);
  });

  it("getStaticCompletions includes P and MC", () => {
    const labels = getStaticCompletions().map((c) => c.label);
    expect(labels).toContain("P");
    expect(labels).toContain("MC");
  });
});
