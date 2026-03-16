#!/usr/bin/env node
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");
const CACHE_PATH = join(root, "data", "market-monitor-cache.json");

function summary(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return { min: null, max: null, avg: null, median: null };
  const min = nums[0];
  const max = nums[nums.length - 1];
  const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
  return { min, max, avg, median };
}

function main() {
  if (existsSync(CACHE_PATH)) {
    try {
      const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      if (Array.isArray(cache.rows) && cache.rows.length > 0) {
        const rows = cache.rows;
        const series = {
          up4pct: rows.map((r) => r.up4pct),
          down4pct: rows.map((r) => r.down4pct),
          ratio5d: rows.map((r) => r.ratio5d),
          ratio10d: rows.map((r) => r.ratio10d),
          up25pct_qtr: rows.map((r) => r.up25pct_qtr),
          down25pct_qtr: rows.map((r) => r.down25pct_qtr),
          up25pct_month: rows.map((r) => r.up25pct_month),
          down25pct_month: rows.map((r) => r.down25pct_month),
          up50pct_month: rows.map((r) => r.up50pct_month),
          down50pct_month: rows.map((r) => r.down50pct_month),
          universe: rows.map((r) => r.universe),
        };
        console.log(`Market Monitor distribution (${cache.startDate} -> ${cache.latestDate}) [cache]`);
        for (const [name, values] of Object.entries(series)) {
          const s = summary(values);
          const avg = s.avg == null ? "null" : s.avg.toFixed(2);
          console.log(`${name}: min=${s.min}, max=${s.max}, median=${s.median}, avg=${avg}`);
        }
        return;
      }
    } catch {
      // ignore cache parsing issues
    }
  }

  const db = new Database(DB_PATH, { readonly: true });
  const latestRow = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get();
  const latestDate = latestRow?.d;
  if (!latestDate) throw new Error("No date in quote_daily");
  const end = new Date(latestDate);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 2);
  const startDate = start.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      SELECT
        q.date AS date,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 THEN 1 ELSE 0 END) AS universe,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND (
               (SELECT db.close FROM daily_bars db WHERE db.symbol = q.symbol AND db.date = q.date LIMIT 1) -
               (SELECT db2.close FROM daily_bars db2 WHERE db2.symbol = q.symbol AND db2.date < q.date ORDER BY db2.date DESC LIMIT 1)
             ) * 100.0 / NULLIF((SELECT db3.close FROM daily_bars db3 WHERE db3.symbol = q.symbol AND db3.date < q.date ORDER BY db3.date DESC LIMIT 1), 0) >= 4
              THEN 1
            ELSE 0
          END
        ) AS up4pct,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND (
               (SELECT db.close FROM daily_bars db WHERE db.symbol = q.symbol AND db.date = q.date LIMIT 1) -
               (SELECT db2.close FROM daily_bars db2 WHERE db2.symbol = q.symbol AND db2.date < q.date ORDER BY db2.date DESC LIMIT 1)
             ) * 100.0 / NULLIF((SELECT db3.close FROM daily_bars db3 WHERE db3.symbol = q.symbol AND db3.date < q.date ORDER BY db3.date DESC LIMIT 1), 0) <= -4
              THEN 1
            ELSE 0
          END
        ) AS down4pct,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 AND i.price_change_3m_pct >= 25 THEN 1 ELSE 0 END) AS up25pct_qtr,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 AND i.price_change_3m_pct <= -25 THEN 1 ELSE 0 END) AS down25pct_qtr,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 AND i.price_change_1m_pct >= 25 THEN 1 ELSE 0 END) AS up25pct_month,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 AND i.price_change_1m_pct <= -25 THEN 1 ELSE 0 END) AS down25pct_month,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 AND i.price_change_1m_pct >= 50 THEN 1 ELSE 0 END) AS up50pct_month,
        SUM(CASE WHEN COALESCE(q.last_price, 0) > 5 AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000 AND i.price_change_1m_pct <= -50 THEN 1 ELSE 0 END) AS down50pct_month,
        0 AS _unused_up13pct_34d,
        0 AS _unused_down13pct_34d
      FROM quote_daily q
      LEFT JOIN indicators_daily i ON i.symbol = q.symbol AND i.date = q.date
      WHERE q.date BETWEEN ? AND ?
      GROUP BY q.date
      ORDER BY q.date ASC
      `
    )
    .all(startDate, latestDate);

  const prefixUp = [];
  const prefixDown = [];
  for (let i = 0; i < rows.length; i++) {
    prefixUp[i] = (i > 0 ? prefixUp[i - 1] : 0) + rows[i].up4pct;
    prefixDown[i] = (i > 0 ? prefixDown[i - 1] : 0) + rows[i].down4pct;
  }
  const windowRatio = (endIdx, window) => {
    const startIdx = Math.max(0, endIdx - window + 1);
    const up = prefixUp[endIdx] - (startIdx > 0 ? prefixUp[startIdx - 1] : 0);
    const down = prefixDown[endIdx] - (startIdx > 0 ? prefixDown[startIdx - 1] : 0);
    if (down <= 0) return null;
    return up / down;
  };

  const series = {
    up4pct: rows.map((r) => r.up4pct),
    down4pct: rows.map((r) => r.down4pct),
    ratio5d: rows.map((_, i) => windowRatio(i, 5)),
    ratio10d: rows.map((_, i) => windowRatio(i, 10)),
    up25pct_qtr: rows.map((r) => r.up25pct_qtr),
    down25pct_qtr: rows.map((r) => r.down25pct_qtr),
    up25pct_month: rows.map((r) => r.up25pct_month),
    down25pct_month: rows.map((r) => r.down25pct_month),
    up50pct_month: rows.map((r) => r.up50pct_month),
    down50pct_month: rows.map((r) => r.down50pct_month),
    universe: rows.map((r) => r.universe),
  };

  console.log(`Market Monitor distribution (${startDate} -> ${latestDate})`);
  for (const [name, values] of Object.entries(series)) {
    const s = summary(values);
    const avg = s.avg == null ? "null" : s.avg.toFixed(2);
    console.log(`${name}: min=${s.min}, max=${s.max}, median=${s.median}, avg=${avg}`);
  }
  db.close();
}

main();

