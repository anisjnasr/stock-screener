import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as etYmd from "@/lib/et-ymd";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/screener-db-native", () => ({
  getLatestLargeCapDbSessionDate: vi.fn(() => "2026-05-18"),
}));

describe("resolveLargeCapAnalysisDate", () => {
  let resolveLargeCapAnalysisDate: () => string;

  beforeAll(async () => {
    const mod = await import("./large-cap-analysis-date");
    resolveLargeCapAnalysisDate = mod.resolveLargeCapAnalysisDate;
  });

  beforeEach(() => {
    vi.spyOn(etYmd, "ymdInEt");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses today when DB latest is prior session", () => {
    vi.mocked(etYmd.ymdInEt).mockReturnValue("2026-05-19");
    expect(resolveLargeCapAnalysisDate()).toBe("2026-05-19");
  });

  it("bumps to day after latest when calendar today equals latest session", () => {
    vi.mocked(etYmd.ymdInEt).mockReturnValue("2026-05-18");
    expect(resolveLargeCapAnalysisDate()).toBe("2026-05-19");
  });
});
