import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCompLabSession,
  COMP_LAB_SESSION_LS_KEY,
  loadCompLabSession,
  saveCompLabSession,
} from "@/lib/complab/comp-lab-session-storage";

describe("comp-lab-session-storage", () => {
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

  it("round-trips session for the same ET day", () => {
    saveCompLabSession({
      version: 1,
      sessionDateEt: "2026-05-21",
      ticker: "AMD",
      companyName: "Advanced Micro Devices, Inc.",
      referenceDate: "2024-03-15",
    });
    const loaded = loadCompLabSession("2026-05-21");
    expect(loaded?.ticker).toBe("AMD");
    expect(loaded?.referenceDate).toBe("2024-03-15");
  });

  it("returns null when session date differs", () => {
    saveCompLabSession({
      version: 1,
      sessionDateEt: "2026-05-20",
      ticker: "AMD",
      companyName: "Advanced Micro Devices, Inc.",
    });
    expect(loadCompLabSession("2026-05-21")).toBeNull();
  });

  it("clears storage", () => {
    saveCompLabSession({
      version: 1,
      sessionDateEt: "2026-05-21",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
    });
    clearCompLabSession();
    expect(store[COMP_LAB_SESSION_LS_KEY]).toBeUndefined();
  });
});
