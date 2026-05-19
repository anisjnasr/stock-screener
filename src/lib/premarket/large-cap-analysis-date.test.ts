import { describe, expect, it, vi } from "vitest";
import * as etYmd from "@/lib/et-ymd";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/screener-db-native", () => ({
  getLatestLargeCapDbSessionDate: vi.fn(() => "2026-05-18"),
}));

describe("resolveLargeCapAnalysisDate", () => {
  it("uses today when DB latest is prior session", async () => {
    vi.spyOn(etYmd, "ymdInEt").mockReturnValue("2026-05-19");
    const { resolveLargeCapAnalysisDate } = await import("./large-cap-analysis-date");
    expect(resolveLargeCapAnalysisDate()).toBe("2026-05-19");
  });

  it("bumps to day after latest when calendar today equals latest session", async () => {
    vi.spyOn(etYmd, "ymdInEt").mockReturnValue("2026-05-18");
    vi.resetModules();
    const { resolveLargeCapAnalysisDate } = await import("./large-cap-analysis-date");
    expect(resolveLargeCapAnalysisDate()).toBe("2026-05-19");
  });
});
