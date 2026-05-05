#!/usr/bin/env node
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");

const ACRONYM_CANON = new Map(
  Object.entries({
    ai: "AI",
    adr: "ADR",
    adrs: "ADRs",
    ar: "AR",
    ev: "EV",
    etf: "ETF",
    etfs: "ETFs",
    ml: "ML",
    reit: "REIT",
    reits: "REITs",
    vr: "VR",
    lng: "LNG",
    oem: "OEM",
    saas: "SaaS",
    iot: "IoT",
  })
);

function normalizeWord(word) {
  const lower = word.toLowerCase();
  const canon = ACRONYM_CANON.get(lower);
  if (canon) return canon;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function normalizeIndustryName(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || t.toUpperCase() === "NA") return t;
  return t.replace(/[A-Za-z][A-Za-z0-9']*/g, (token) => normalizeWord(token));
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Missing DB at ${DB_PATH}`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");

  const rows = db
    .prepare("SELECT symbol, industry FROM companies WHERE industry IS NOT NULL AND TRIM(industry) <> ''")
    .all();

  const update = db.prepare("UPDATE companies SET industry = ?, updated_at = ? WHERE symbol = ?");
  const now = new Date().toISOString();

  let changed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const normalized = normalizeIndustryName(r.industry);
      if (normalized !== r.industry) {
        update.run(normalized, now, r.symbol);
        changed += 1;
      }
    }
  });
  tx();

  const distinct = db
    .prepare("SELECT COUNT(DISTINCT industry) AS c FROM companies WHERE industry IS NOT NULL AND TRIM(industry) <> ''")
    .get().c;
  const allUpper = db
    .prepare("SELECT COUNT(*) AS c FROM (SELECT DISTINCT industry FROM companies WHERE industry IS NOT NULL AND TRIM(industry) <> '' AND industry = UPPER(industry))")
    .get().c;

  console.log(`Normalized industry names for ${changed} companies.`);
  console.log(`Distinct industries: ${distinct}`);
  console.log(`Distinct all-uppercase industries remaining: ${allUpper}`);
  db.close();
}

main();
