/**
 * One-off diagnostic: compare quote_daily "reliable" date vs daily_bars coverage for SSL.
 * Run: node scripts/ssl-scan-diagnostic.mjs
 */
import Database from "better-sqlite3";
import { join } from "path";

const dbPath = process.env.SCREENER_DB_PATH ?? join(process.cwd(), "data", "screener.db");
const db = new Database(dbPath, { readonly: true });

function getLatestReliableScreenerDateFromDb() {
  const latestRow = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get();
  const latestDate = latestRow?.d != null ? String(latestRow.d) : null;
  if (!latestDate) return null;

  const companyCountRow = db.prepare("SELECT COUNT(*) AS c FROM companies").get();
  const companyCount = Number(companyCountRow?.c ?? 0);
  const minCoverage = companyCount > 0 ? Math.max(200, Math.floor(companyCount * 0.8)) : 200;

  const coverageRows = db
    .prepare(
      `
      WITH recent_dates AS (
        SELECT date
        FROM quote_daily
        GROUP BY date
        ORDER BY date DESC
        LIMIT 40
      )
      SELECT rd.date AS date, COUNT(q.symbol) AS cnt
      FROM recent_dates rd
      LEFT JOIN quote_daily q ON q.date = rd.date
      GROUP BY rd.date
      ORDER BY rd.date DESC `
    )
    .all();

  const reliable = coverageRows.find((r) => Number(r.cnt ?? 0) >= minCoverage);
  if (reliable?.date) return String(reliable.date);

  let best = null;
  for (const r of coverageRows) {
    const row = { date: String(r.date), cnt: Number(r.cnt ?? 0) };
    if (!best || row.cnt > best.cnt || (row.cnt === best.cnt && row.date > best.date)) best = row;
  }
  return best && best.cnt > 0 ? best.date : latestDate;
}

const reliableQuote = getLatestReliableScreenerDateFromDb();
const maxQuote = String(db.prepare("SELECT MAX(date) AS d FROM quote_daily").get().d ?? "");
const maxBars = String(db.prepare("SELECT MAX(date) AS d FROM daily_bars").get().d ?? "");
const barRowCount = db.prepare("SELECT COUNT(*) AS c FROM daily_bars").get().c;

const symSample = db
  .prepare(
    "SELECT c.symbol FROM companies c INNER JOIN quote_daily q ON q.symbol=c.symbol AND q.date = ? LIMIT 8"
  )
  .all(reliableQuote)
  .map((r) => r.symbol);

const uni = db
  .prepare(
    "SELECT COUNT(DISTINCT c.symbol) AS c FROM companies c INNER JOIN quote_daily q ON q.symbol=c.symbol AND q.date = ?"
  )
  .get(reliableQuote).c;

const withBarsRaw = db
  .prepare(
    `SELECT COUNT(DISTINCT b.symbol) AS c
     FROM daily_bars b
     INNER JOIN companies c ON c.symbol = b.symbol
     INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
     WHERE b.date <= ?`
  )
  .get(reliableQuote, reliableQuote).c;

const withBarsDateFn = db
  .prepare(
    `SELECT COUNT(DISTINCT b.symbol) AS c
     FROM daily_bars b
     INNER JOIN companies c ON c.symbol = b.symbol
     INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
     WHERE date(b.date) <= date(?)`
  )
  .get(reliableQuote, reliableQuote).c;

console.log(
  JSON.stringify(
    {
      dbPath,
      reliableQuoteDate: reliableQuote,
      maxQuoteDaily: maxQuote,
      maxDailyBars: maxBars,
      dailyBarsRowCount: barRowCount,
      universeSymbolsOnReliableQuoteDate: uni,
      universeSymbolsWithBar_date_lte_reliable: withBarsRaw,
      universeSymbolsWithBar_dateFn_lte_reliable: withBarsDateFn,
    },
    null,
    2
  )
);

for (const sym of symSample.length ? symSample : ["AAPL"]) {
  const raw = db.prepare("SELECT COUNT(*) AS c FROM daily_bars WHERE symbol = ? AND date <= ?").get(sym, reliableQuote).c;
  const dfn = db
    .prepare("SELECT COUNT(*) AS c FROM daily_bars WHERE symbol = ? AND date(date) <= date(?)")
    .get(sym, reliableQuote).c;
  const latest = db.prepare("SELECT date, close FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT 1").get(sym);
  const sampleDates = db
    .prepare("SELECT date FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT 3")
    .all(sym)
    .map((r) => r.date);
  console.log(sym, { rawCompareCount: raw, dateFuncCount: dfn, latestBar: latest, sampleDateStrings: sampleDates });
}

db.close();
