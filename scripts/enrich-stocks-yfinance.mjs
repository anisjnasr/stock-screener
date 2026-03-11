#!/usr/bin/env node
/**
 * Enrich local stocks DB with sector and industry from yfinance (Yahoo Finance via yahoo-finance2).
 * Reads data/all-stocks.json, fetches sector/industry for each stock, writes back with sector + industry.
 * If unavailable, leaves blank. Reports count of stocks with missing industry and/or sector.
 * Run: node scripts/enrich-stocks-yfinance.mjs  or  npm run enrich-stocks
 * Requires: data/all-stocks.json (from npm run build-stocks-db)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_PATH = join(root, "data", "all-stocks.json");

const DELAY_MS = 80;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!existsSync(DATA_PATH)) {
    console.error("Missing data/all-stocks.json. Run: npm run build-stocks-db");
    process.exit(1);
  }

  const raw = readFileSync(DATA_PATH, "utf8");
  const db = JSON.parse(raw);
  const { stocks } = db;
  if (!Array.isArray(stocks) || stocks.length === 0) {
    console.error("No stocks in database.");
    process.exit(1);
  }

  const YahooFinance = (await import("yahoo-finance2")).default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  console.log(`Enriching ${stocks.length} stocks with sector/industry from Yahoo Finance...\n`);

  let done = 0;
  let missingSector = 0;
  let missingIndustry = 0;
  let missingEither = 0;

  for (let i = 0; i < stocks.length; i++) {
    const row = stocks[i];
    const symbol = row.symbol;

    try {
      const result = await yf.quoteSummary(symbol, { modules: ["assetProfile"] });
      const profile = result?.assetProfile ?? {};
      const sector =
        profile.sector != null && String(profile.sector).trim() !== ""
          ? String(profile.sector).trim()
          : "";
      const industry =
        profile.industry != null && String(profile.industry).trim() !== ""
          ? String(profile.industry).trim()
          : "";

      row.sector = sector;
      row.industry = industry;

      if (sector === "") missingSector++;
      if (industry === "") missingIndustry++;
      if (sector === "" || industry === "") missingEither++;
    } catch {
      row.sector = "";
      row.industry = "";
      missingSector++;
      missingIndustry++;
      missingEither++;
    }

    done++;
    if (done % 100 === 0 || done === stocks.length) {
      process.stdout.write(`  ${done}/${stocks.length} stocks processed...\r`);
    }
    await sleep(DELAY_MS);
  }

  db.sectorEnrichedAt = new Date().toISOString();
  writeFileSync(DATA_PATH, JSON.stringify(db, null, 0), "utf8");

  console.log("\n");
  console.log("Saved to:", DATA_PATH);
  console.log("");
  console.log("Missing data counts:");
  console.log("  Missing sector:        ", missingSector);
  console.log("  Missing industry:     ", missingIndustry);
  console.log("  Missing sector and/or industry:", missingEither);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
