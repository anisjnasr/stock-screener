#!/usr/bin/env node
/**
 * Compare ETF constituent JSON files against `companies` in screener.db.
 *
 * The build scripts scrape a limited "top holdings" table per ETF, so counts are
 * expected to be far below full fund holdings — this audit flags missing DB rows
 * and zero-length lists for operational debugging.
 *
 * Run:
 *   node scripts/audit-etf-constituents.mjs
 *   node scripts/audit-etf-constituents.mjs --out data/etf-constituents-audit.json
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, dataDir } from "./_db-paths.mjs";

const THEMATIC_JSON = join(dataDir, "thematic-etf-constituents.json");
const SECTOR_JSON = join(dataDir, "sector-etf-constituents.json");
const INDUSTRY_JSON = join(dataDir, "industry-etf-constituents.json");

function getArgValue(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function loadJsonMap(path, label) {
  if (!existsSync(path)) {
    console.warn(`[skip] ${label}: file not found (${path})`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.warn(`[skip] ${label}: invalid JSON (${e.message})`);
    return null;
  }
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean);
}

function auditFile(db, stmt, label, data) {
  const etfs = [];
  let totalSymbols = 0;
  let totalInDb = 0;
  let warnings = 0;

  for (const [etf, raw] of Object.entries(data)) {
    const symbols = normalizeList(raw);
    const key = etf.toUpperCase();
    let inDb = 0;
    const missing = [];
    for (const sym of symbols) {
      const row = stmt.get(sym);
      if (row) inDb++;
      else missing.push(sym);
    }
    totalSymbols += symbols.length;
    totalInDb += inDb;
    const entry = {
      etf: key,
      count: symbols.length,
      inCompanies: inDb,
      missingInDb: missing.length,
      missingSample: missing.slice(0, 8),
    };
    etfs.push(entry);
    if (symbols.length === 0) {
      console.warn(`  [!] ${label} ${key}: zero constituents`);
      warnings++;
    } else if (missing.length > symbols.length * 0.25) {
      console.warn(`  [!] ${label} ${key}: ${missing.length}/${symbols.length} symbols not in companies`);
      warnings++;
    }
  }

  etfs.sort((a, b) => b.missingInDb - a.missingInDb);
  return { label, etfCount: etfs.length, totalSymbols, totalInDb, etfs, warnings };
}

function main() {
  const outPath = getArgValue("--out", join(dataDir, "etf-constituents-audit.json"));

  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  db.pragma("query_only = ON");
  const stmt = db.prepare("SELECT 1 AS ok FROM companies WHERE symbol = ? COLLATE NOCASE LIMIT 1");

  const sections = [];
  const thematic = loadJsonMap(THEMATIC_JSON, "thematic");
  if (thematic && typeof thematic === "object") {
    sections.push(auditFile(db, stmt, "thematic", thematic));
  }
  const sector = loadJsonMap(SECTOR_JSON, "sector");
  if (sector && typeof sector === "object") {
    sections.push(auditFile(db, stmt, "sector", sector));
  }
  const industry = loadJsonMap(INDUSTRY_JSON, "industry");
  if (industry && typeof industry === "object") {
    sections.push(auditFile(db, stmt, "industry", industry));
  }

  db.close();

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    sections,
    summary: {
      filesPresent: sections.length,
      warningCount: sections.reduce((a, s) => a + s.warnings, 0),
    },
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
  for (const s of sections) {
    const pct = s.totalSymbols ? ((s.totalInDb / s.totalSymbols) * 100).toFixed(1) : "0";
    console.log(
      `  ${s.label}: ${s.etfCount} ETFs, ${s.totalSymbols} constituent rows, ${s.totalInDb} in companies (${pct}%), ${s.warnings} ETF-level warnings`
    );
  }
}

main();
