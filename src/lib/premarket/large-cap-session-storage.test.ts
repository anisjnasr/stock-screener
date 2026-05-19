import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLargeCapSession,
  loadLargeCapSession,
  saveLargeCapSession,
  LARGE_CAP_SESSION_LS_KEY,
} from "@/lib/premarket/large-cap-session-storage";

describe("large-cap-session-storage", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips session for matching profile/settings/date", () => {
    saveLargeCapSession({
      version: 1,
      profileId: "p1",
      settingsKey: "list1|historical",
      tradingDateEt: "2026-05-19",
      lastRunAt: "2026-05-19T12:00:00Z",
      rows: {
        AAPL: { status: "done", cache_hit: true, verdict: { verdict: "No Trade" } },
      },
    });
    const loaded = loadLargeCapSession("p1", "list1|historical", "2026-05-19");
    expect(loaded?.rows.AAPL?.status).toBe("done");
    expect(loaded?.rows.AAPL?.cache_hit).toBe(true);
  });

  it("returns null when trading date differs", () => {
    saveLargeCapSession({
      version: 1,
      profileId: "p1",
      settingsKey: "list1|historical",
      tradingDateEt: "2026-05-18",
      lastRunAt: null,
      rows: {},
    });
    expect(loadLargeCapSession("p1", "list1|historical", "2026-05-19")).toBeNull();
  });

  it("clears storage", () => {
    saveLargeCapSession({
      version: 1,
      profileId: "p1",
      settingsKey: "x",
      tradingDateEt: "2026-05-19",
      lastRunAt: null,
      rows: {},
    });
    clearLargeCapSession();
    expect(store[LARGE_CAP_SESSION_LS_KEY]).toBeUndefined();
  });
});
