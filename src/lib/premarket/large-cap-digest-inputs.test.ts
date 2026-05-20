import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function makeFixtureDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (symbol TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE daily_bars (
      symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER
    );
    CREATE TABLE indicators_daily (
      symbol TEXT, date TEXT,
      price_change_1w_pct REAL, price_change_1m_pct REAL, price_change_3m_pct REAL,
      price_change_6m_pct REAL, price_change_12m_pct REAL,
      atr_14 REAL, atr_pct_14 REAL, atr_21 REAL, atr_pct_21 REAL,
      ema_20 REAL, ema_50 REAL, ema_100 REAL, ema_200 REAL,
      above_ema_20 INTEGER, pct_from_ema_20 REAL, above_ema_50 INTEGER, pct_from_ema_50 REAL,
      above_ema_100 INTEGER, pct_from_ema_100 REAL, above_ema_200 INTEGER, pct_from_ema_200 REAL,
      ema_20_above_50 INTEGER, ema_50_above_100 INTEGER, ema_50_above_200 INTEGER, ema_100_above_200 INTEGER
    );
    CREATE TABLE quote_daily (symbol TEXT, date TEXT, high_52w REAL, off_52w_high_pct REAL, prev_close REAL);
  `);
  db.prepare("INSERT INTO companies VALUES (?, ?)").run("MU", "Micron Technology");
  for (const [date, close] of [
    ["2026-05-16", 90],
    ["2026-05-19", 95],
  ] as const) {
    db.prepare(
      "INSERT INTO daily_bars VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("MU", date, close - 1, close + 1, close - 2, close, 1_000_000);
    db.prepare(
      `INSERT INTO indicators_daily (
        symbol, date, atr_21, atr_pct_21, ema_20, ema_50, ema_100, ema_200,
        ema_20_above_50, ema_50_above_100, ema_50_above_200, ema_100_above_200
      ) VALUES (?, ?, 2, 2, 94, 90, 88, 85, 1, 1, 1, 1)`
    ).run("MU", date);
    db.prepare("INSERT INTO quote_daily VALUES (?, ?, ?, ?, ?)").run("MU", date, 100, -5, close - 1);
  }
  return db;
}

vi.mock("@/lib/screener-db-native", () => ({
  withScreenerDb: (fn: (db: Database.Database) => unknown) => fn(makeFixtureDb()),
  getLatestLargeCapDbSessionDate: () => "2026-05-19",
}));

describe("fetchLargeCapDigestInputs", () => {
  it("loads EMA stack flags using indicators_daily column names", async () => {
    const { fetchLargeCapDigestInputs } = await import("./large-cap-digest-inputs");
    const inputs = fetchLargeCapDigestInputs("MU", "2026-05-20");
    expect(inputs.company.symbol).toBe("MU");
    expect(inputs.bars.length).toBeGreaterThanOrEqual(2);
    expect(inputs.indicators_prior.ema_20_above_ema_50).toBe(1);
    expect(inputs.indicators_prior.ema_50_above_ema_100).toBe(1);
    expect(inputs.indicators_prior.ema_50_above_ema_200).toBe(1);
    expect(inputs.indicators_prior.ema_100_above_ema_200).toBe(1);
  });
});
