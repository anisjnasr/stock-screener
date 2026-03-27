#!/usr/bin/env node
/**
 * Pre-compute sector, industry, index, and thematic ETF performance
 * for all timeframes and store in performance_cache table.
 *
 * Run standalone:  node scripts/precompute-performance.mjs
 * Also called automatically at the end of refresh-daily.mjs
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

const INDEX_TICKERS = ["SPY", "QQQ", "IWM"];

function loadThematicEtfs() {
  const tePath = join(root, "src", "lib", "thematic-etfs.ts");
  if (!existsSync(tePath)) return [];
  const src = readFileSync(tePath, "utf8");
  const tickers = [];
  const re = /ticker:\s*"([A-Z]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) tickers.push(m[1]);
  return tickers;
}

const TIMEFRAMES = [
  { name: "day", lookback: 1 },
  { name: "week", lookback: 5 },
  { name: "month", lookback: 21 },
  { name: "quarter", lookback: 63 },
  { name: "half_year", lookback: 126 },
  { name: "year", lookback: 252 },
];

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("cache_size = -64000");
  db.pragma("busy_timeout = 10000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_cache (
      category_type TEXT NOT NULL,
      name TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      change_pct REAL,
      total_market_cap REAL,
      stock_count INTEGER,
      date TEXT NOT NULL,
      PRIMARY KEY (category_type, name, timeframe, date)
    )
  `);

  const latestDateRow = db.prepare(
    "SELECT MAX(date) AS d FROM daily_bars WHERE date <= date('now')"
  ).get();
  const asOfDate = latestDateRow?.d;
  if (!asOfDate) {
    console.error("No data in daily_bars.");
    db.close();
    process.exit(1);
  }

  // Add YTD: compute trading days from Jan 1 to asOfDate
  const d = new Date(`${asOfDate}T00:00:00Z`);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const calDays = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const ytdLookback = Math.max(1, Math.round(calDays * (252 / 365)));
  const allTimeframes = [...TIMEFRAMES, { name: "ytd", lookback: ytdLookback }];

  console.log(`Pre-computing performance for date: ${asOfDate}`);
  console.log(`YTD lookback: ${ytdLookback} trading days`);

  // Clear old cache for this date
  db.prepare("DELETE FROM performance_cache WHERE date = ?").run(asOfDate);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO performance_cache
      (category_type, name, timeframe, change_pct, total_market_cap, stock_count, date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let totalRows = 0;

  for (const tf of allTimeframes) {
    const startDate = (() => {
      const sd = new Date(`${asOfDate}T00:00:00Z`);
      sd.setUTCDate(sd.getUTCDate() - Math.max(tf.lookback * 2 + 40, tf.lookback + 40));
      return sd.toISOString().slice(0, 10);
    })();

    // Weighted sector performance
    for (const groupBy of ["sector", "industry"]) {
      const sql = `
        WITH base AS (
          SELECT d.symbol, d.date, d.close,
            LAG(d.close, ${tf.lookback}) OVER (PARTITION BY d.symbol ORDER BY d.date) AS prev_close
          FROM daily_bars d
          INNER JOIN companies c ON c.symbol = d.symbol
          WHERE d.date BETWEEN ? AND ?
        ),
        latest AS (
          SELECT b.symbol, b.close, b.prev_close
          FROM base b
          WHERE b.date <= ? AND b.prev_close > 0 AND b.close > 0
            AND b.date = (SELECT MAX(b2.date) FROM base b2 WHERE b2.symbol = b.symbol AND b2.date <= ? AND b2.prev_close > 0 AND b2.close > 0)
        ),
        latest_cap AS (
          SELECT q.symbol, q.market_cap
          FROM quote_daily q
          INNER JOIN (SELECT symbol, MAX(date) AS max_date FROM quote_daily WHERE date <= ? GROUP BY symbol) x
            ON x.symbol = q.symbol AND x.max_date = q.date
        ),
        mc AS (
          SELECT l.symbol, COALESCE(lc.market_cap, c.shares_outstanding * l.close) AS market_cap
          FROM latest l
          INNER JOIN companies c ON c.symbol = l.symbol
          LEFT JOIN latest_cap lc ON lc.symbol = l.symbol
        )
        SELECT c.${groupBy} AS name,
          SUM(mc.market_cap * ((l.close - l.prev_close) * 100.0 / NULLIF(l.prev_close, 0))) / SUM(mc.market_cap) AS change_pct,
          SUM(mc.market_cap) AS total_market_cap,
          COUNT(*) AS stock_count
        FROM latest l
        INNER JOIN companies c ON c.symbol = l.symbol
        LEFT JOIN mc ON mc.symbol = l.symbol
        WHERE c.${groupBy} IS NOT NULL AND TRIM(c.${groupBy}) <> '' AND c.${groupBy} <> 'NA'
          AND mc.market_cap IS NOT NULL AND mc.market_cap > 0
        GROUP BY c.${groupBy}
        HAVING SUM(mc.market_cap) > 0
      `;
      const rows = db.prepare(sql).all(startDate, asOfDate, asOfDate, asOfDate, asOfDate);
      const insertTx = db.transaction(() => {
        for (const r of rows) {
          upsert.run(groupBy, String(r.name), tf.name, Number(r.change_pct ?? 0), Number(r.total_market_cap ?? 0), Number(r.stock_count ?? 0), asOfDate);
          totalRows++;
        }
      });
      insertTx();
    }

    // Ticker-based performance (indices + thematic ETFs)
    const thematicTickers = loadThematicEtfs();
    const allTickers = [...INDEX_TICKERS, ...thematicTickers];
    const unique = [...new Set(allTickers.map((s) => s.toUpperCase()))];
    const placeholders = unique.map(() => "?").join(",");
    const tickerSql = `
      WITH base AS (
        SELECT d.symbol, d.date, d.close,
          LAG(d.close, ${tf.lookback}) OVER (PARTITION BY d.symbol ORDER BY d.date) AS prev_close
        FROM daily_bars d
        WHERE d.symbol IN (${placeholders}) AND d.date BETWEEN ? AND ?
      ),
      latest AS (
        SELECT b.symbol, b.close, b.prev_close
        FROM base b
        WHERE b.date <= ? AND b.prev_close > 0 AND b.close > 0
          AND b.date = (SELECT MAX(b2.date) FROM base b2 WHERE b2.symbol = b.symbol AND b2.date <= ? AND b2.prev_close > 0 AND b2.close > 0)
      )
      SELECT l.symbol, ((l.close - l.prev_close) * 100.0 / NULLIF(l.prev_close, 0)) AS change_pct
      FROM latest l
    `;
    const tickerRows = db.prepare(tickerSql).all(...unique, startDate, asOfDate, asOfDate, asOfDate);
    const insertTickerTx = db.transaction(() => {
      for (const r of tickerRows) {
        const isIndex = INDEX_TICKERS.includes(r.symbol);
        upsert.run(isIndex ? "index" : "thematic", String(r.symbol), tf.name, Number(r.change_pct ?? 0), null, null, asOfDate);
        totalRows++;
      }
    });
    insertTickerTx();

    process.stdout.write(`  ${tf.name}: done\n`);
  }

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();

  console.log(`Pre-computed ${totalRows} performance rows for ${asOfDate}.`);
}

main();
