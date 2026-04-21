import { describe, expect, it } from "vitest";
import {
  computeMonthlyMomPercent,
  computeMonthlyYoYPercent,
  computePayrollsChangeThousands,
  formatActualForDisplay,
  pickLatestOnOrBefore,
} from "./fredActuals";

describe("pickLatestOnOrBefore", () => {
  it("returns latest observation on or before grace end", () => {
    const obs = [
      { date: "2026-04-01", value: "100" },
      { date: "2026-03-01", value: "99" },
    ];
    expect(pickLatestOnOrBefore(obs, "2026-04-15")).toEqual({ date: "2026-04-01", v: 100 });
    expect(pickLatestOnOrBefore(obs, "2026-03-15")).toEqual({ date: "2026-03-01", v: 99 });
    expect(pickLatestOnOrBefore(obs, "2026-02-15")).toBeNull();
  });

  it("skips dotted missing values", () => {
    const obs = [
      { date: "2026-04-01", value: "." },
      { date: "2026-03-01", value: "50" },
    ];
    expect(pickLatestOnOrBefore(obs, "2026-04-20")).toEqual({ date: "2026-03-01", v: 50 });
  });
});

describe("computeMonthlyYoYPercent", () => {
  it("computes YoY from 13 monthly levels", () => {
    const obs: { date: string; value: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 3 - i, 1));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const level = 100 + (13 - i) * 0.5;
      obs.push({ date: `${y}-${m}-${day}`, value: String(level) });
    }
    const yoy = computeMonthlyYoYPercent(obs, "2026-04-05");
    expect(yoy).not.toBeNull();
    expect(yoy!).toBeGreaterThan(0);
  });
});

describe("computeMonthlyMomPercent", () => {
  it("computes MoM % from two months", () => {
    const obs = [
      { date: "2026-04-01", value: "110" },
      { date: "2026-03-01", value: "100" },
    ];
    const mom = computeMonthlyMomPercent(obs, "2026-04-10");
    expect(mom).toBeCloseTo(10, 5);
  });
});

describe("computePayrollsChangeThousands", () => {
  it("returns level difference in thousands units", () => {
    const obs = [
      { date: "2026-04-01", value: "160200" },
      { date: "2026-03-01", value: "160000" },
    ];
    const ch = computePayrollsChangeThousands(obs, "2026-04-10");
    expect(ch).toBe(200);
  });
});

describe("formatActualForDisplay", () => {
  it("formats UNRATE-style percent", () => {
    expect(formatActualForDisplay("UNRATE", "percent", 3.8)).toBe("3.8%");
  });

  it("formats ICSA as K", () => {
    expect(formatActualForDisplay("ICSA", "thousands", 224000)).toBe("224K");
  });
});
