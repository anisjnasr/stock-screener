#!/usr/bin/env node
/**
 * Push ETF daily bars from local DB to production Render instance.
 * Usage: ADMIN_SECRET=xxx node scripts/push-bars-to-render.mjs
 *    or: node scripts/push-bars-to-render.mjs --secret xxx
 */
import { createRequire } from "module";
import { dbPath as DB_PATH } from "./_db-paths.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const RENDER_URL = "https://stock-screener-orfz.onrender.com";
const CHUNK_SIZE = 5000;

const args = process.argv.slice(2);
const secretIdx = args.indexOf("--secret");
const ADMIN_SECRET =
  (secretIdx >= 0 ? args[secretIdx + 1] : null) ||
  process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error("Provide ADMIN_SECRET via --secret flag or environment variable.");
  process.exit(1);
}

const ETF_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA", "RSP", "QQQE",
  "XLK", "XLF", "XLV", "XLY", "XLP", "XLC", "XLI", "XLE", "XLB", "XLRE", "XLU",
  "ITA", "JETS", "CARZ", "KBE", "KRE", "PBJ", "XBI", "KCE", "XPH", "BETZ",
  "GDX", "IHF", "ITB", "KIE", "IHI", "XME", "XOP", "VNQ", "SMH", "IGV",
  "XRT", "IYZ", "IYT",
  "BOTZ", "SKYY", "CIBR", "DTCR", "SNSR", "QTUM", "ARKX", "ARKK",
  "ICLN", "TAN", "URA", "HYDR", "PHO", "LIT", "PAVE", "GRID",
  "SIL", "COPX", "REMX", "MOO", "IBIT", "BLOK", "FINX", "OZEM",
  "MSOS", "ESPO", "SOCL", "IBUY", "KWEB", "INDA",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pushBars(bars) {
  const res = await fetch(`${RENDER_URL}/api/admin/import-bars`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify({ bars }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log(`Opening local DB: ${DB_PATH}`);
  const db = new Database(DB_PATH, { readonly: true });

  let allBars = [];
  for (const sym of ETF_SYMBOLS) {
    const rows = db
      .prepare(
        "SELECT symbol, date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? ORDER BY date"
      )
      .all(sym);
    if (rows.length > 0) {
      allBars.push(...rows);
      console.log(`  ${sym}: ${rows.length} bars`);
    }
  }
  db.close();

  console.log(`\nTotal bars to push: ${allBars.length}`);
  if (allBars.length === 0) {
    console.log("Nothing to push.");
    return;
  }

  let pushed = 0;
  for (let i = 0; i < allBars.length; i += CHUNK_SIZE) {
    const chunk = allBars.slice(i, i + CHUNK_SIZE);
    try {
      const result = await pushBars(chunk);
      pushed += result.inserted ?? chunk.length;
      const pct = (((i + chunk.length) / allBars.length) * 100).toFixed(1);
      console.log(`  [${pct}%] Pushed ${chunk.length} bars (total: ${pushed})`);
    } catch (e) {
      console.error(`  Error at offset ${i}: ${e.message}`);
      console.log("  Retrying after 5s...");
      await sleep(5000);
      try {
        const result = await pushBars(chunk);
        pushed += result.inserted ?? chunk.length;
      } catch (e2) {
        console.error(`  Retry failed: ${e2.message}`);
        process.exit(1);
      }
    }
    await sleep(500);
  }

  console.log(`\nDone! Pushed ${pushed} bars to ${RENDER_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
