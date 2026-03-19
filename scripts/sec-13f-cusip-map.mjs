/**
 * Build CUSIP -> ticker symbol mapping from 13F issuer names and companies table.
 * Matches "Name of Issuer" to companies.name (normalized). Persists to data/cusip-to-symbol.json.
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parseQuarter13F } from "./sec-13f-parse.mjs";
import { DATA_13F_DIR, QUARTERS_12 } from "./sec-13f-download.mjs";
import { dataDir as DATA_DIR, dbPath as DB_PATH } from "./_db-paths.mjs";

const CUSIP_MAP_PATH = join(DATA_DIR, "cusip-to-symbol.json");
const CUSIP_OVERRIDES_PATH = join(DATA_DIR, "cusip-overrides.json");

function normalizeSymbolForDb(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[./\s]+/g, "-");
}

const SUFFIXES = /\s+(INC\.?|CORP\.?|CORPORATION|CO\.?|LTD\.?|LLC\.?|L\.?L\.?C\.?|PLC|N\.?V\.?|S\.?A\.?|AG|LP|L\.?P\.?|COMPANY|COS?\.?|HOLDINGS|GROUP|PARTNERS|BANCORP|BANK|FINANCIAL|INVESTMENT|TRUST)\s*$/gi;

function normalize(s) {
  if (!s || typeof s !== "string") return "";
  let t = s
    .toLowerCase()
    .replace(/\s+&\s+/g, " and ")
    .replace(/&/g, " and ")
    .replace(/['',.\-]/g, " ")
    .replace(/^\s*the\s+/i, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/**
 * Load companies (symbol, name) from screener.db.
 */
function loadCompanies(db) {
  const rows = db
    .prepare("SELECT symbol, name FROM companies WHERE name IS NOT NULL AND name != ''")
    .all();
  return rows.map((r) => ({ symbol: String(r.symbol), name: String(r.name) }));
}

/**
 * Build normalized name -> symbol map (first match wins; prefer longer name for same norm).
 */
function buildNameToSymbol(companies) {
  const byNorm = new Map();
  for (const { symbol, name } of companies) {
    const n = normalize(name);
    if (!n) continue;
    const existing = byNorm.get(n);
    if (!existing || name.length > existing.name.length) {
      byNorm.set(n, { symbol, name });
    }
  }
  return byNorm;
}

/**
 * Build index: first two words (min 2 chars each) -> list of { symbol, norm }.
 * Used for fallback matching when exact match fails.
 */
function buildFirstTwoWordsIndex(companies) {
  const index = new Map();
  for (const { symbol, name } of companies) {
    const n = normalize(name);
    if (!n) continue;
    const words = n.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < 2) continue;
    const key = `${words[0]} ${words[1]}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ symbol, norm: n });
  }
  return index;
}

/**
 * Try to match issuer name to a company. Returns symbol or null.
 * 1) Exact normalized match.
 * 2) Without common suffixes.
 * 3) Fallback: first two words of issuer match start of exactly one company name.
 */
function matchIssuerToSymbol(issuerName, nameToSymbol, firstTwoWordsIndex) {
  const n = normalize(issuerName);
  if (!n) return null;
  const exact = nameToSymbol.get(n);
  if (exact) return exact.symbol;
  const withoutSuffix = n.replace(/\s+(inc|corp|co|ltd|llc|plc|nv|sa|ag|lp|company|holdings|group|partners|bancorp|bank|financial|investment|trust)\s*$/i, "").trim();
  if (withoutSuffix !== n) {
    const alt = nameToSymbol.get(withoutSuffix);
    if (alt) return alt.symbol;
  }
  const words = n.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 2) {
    const key = `${words[0]} ${words[1]}`;
    const candidates = firstTwoWordsIndex.get(key);
    if (candidates && candidates.length === 1) return candidates[0].symbol;
    if (candidates && candidates.length > 1) {
      const issuerStart = words.slice(0, 3).join(" ");
      const match = candidates.find((c) => c.norm.startsWith(issuerStart) || issuerStart.startsWith(c.norm.slice(0, 20)));
      if (match) return match.symbol;
    }
  }
  return null;
}

/**
 * Collect unique (cusip, issuerName) from ALL available quarter ZIPs in data/13f.
 * Scanning every quarter maximises CUSIP coverage for historical ownership.
 */
function* uniqueCusipIssuers() {
  const seen = new Set();
  for (const q of QUARTERS_12) {
    const p = join(DATA_13F_DIR, `${q.key}.zip`);
    if (!existsSync(p)) continue;
    for (const row of parseQuarter13F(p, q.reportDate)) {
      const key = `${row.cusip}\t${row.issuerName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield { cusip: row.cusip, issuerName: row.issuerName };
    }
  }
}

/**
 * Build and persist CUSIP -> symbol map. Uses one quarter of 13F data + companies table.
 */
export async function buildCusipToSymbolMap() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Missing screener DB at ${DB_PATH}. Run init-screener-db and seed-companies.`);
  }
  const db = new Database(DB_PATH, { readonly: true });
  const companies = loadCompanies(db);
  db.close();
  if (companies.length === 0) {
    throw new Error("No companies in screener.db.");
  }
  const nameToSymbol = buildNameToSymbol(companies);
  const firstTwoWordsIndex = buildFirstTwoWordsIndex(companies);
  const cusipToSymbol = {};
  let matched = 0;
  let total = 0;
  for (const { cusip, issuerName } of uniqueCusipIssuers()) {
    total++;
    if (cusipToSymbol[cusip]) continue;
    const symbol = matchIssuerToSymbol(issuerName, nameToSymbol, firstTwoWordsIndex);
    if (symbol) {
      cusipToSymbol[cusip] = symbol;
      matched++;
    }
  }
  writeFileSync(CUSIP_MAP_PATH, JSON.stringify(cusipToSymbol, null, 0));
  return { total, matched, keys: Object.keys(cusipToSymbol).length };
}

/**
 * Load persisted CUSIP -> symbol map. Merges in cusip-overrides.json if present (e.g. for TSLA 88160R101).
 */
export function loadCusipToSymbolMap() {
  const map = existsSync(CUSIP_MAP_PATH)
    ? JSON.parse(readFileSync(CUSIP_MAP_PATH, "utf8"))
    : {};
  if (existsSync(CUSIP_OVERRIDES_PATH)) {
    const overrides = JSON.parse(readFileSync(CUSIP_OVERRIDES_PATH, "utf8"));
    for (const [cusip, symbol] of Object.entries(overrides)) {
      if (cusip && symbol) map[String(cusip).replace(/\s/g, "")] = String(symbol).toUpperCase();
    }
  }
  return map;
}

function loadCompanyMatchers() {
  const db = new Database(DB_PATH, { readonly: true });
  const companies = loadCompanies(db);
  db.close();
  const nameToSymbol = buildNameToSymbol(companies);
  const firstTwoWordsIndex = buildFirstTwoWordsIndex(companies);
  const validSymbols = new Set(
    companies.map((c) => normalizeSymbolForDb(String(c.symbol || ""))).filter(Boolean)
  );
  return Promise.resolve({ nameToSymbol, firstTwoWordsIndex, validSymbols });
}

/**
 * Resolve CUSIP -> symbol using:
 * 1) existing saved map + overrides
 * 2) issuer-name heuristic fallback
 *
 * @param {Array<{cusip:string, issuerName?:string}>} pairs
 */
export async function resolveCusipMap(pairs) {
  const entries = Array.isArray(pairs) ? pairs : [];
  const map = loadCusipToSymbolMap();
  const uniquePairs = new Map();
  for (const p of entries) {
    const cusip = String(p?.cusip || "").trim().replace(/\s/g, "");
    if (!cusip || cusip.length !== 9) continue;
    if (!uniquePairs.has(cusip)) {
      uniquePairs.set(cusip, { cusip, issuerName: String(p?.issuerName || "").trim() });
    }
  }
  if (uniquePairs.size === 0) {
    return { map, stats: { totalCusips: 0, mappedBefore: 0, heuristicAdded: 0 } };
  }

  const { nameToSymbol, firstTwoWordsIndex, validSymbols } = await loadCompanyMatchers();
  const unresolvedCusips = [...uniquePairs.keys()].filter((cusip) => !map[cusip]);

  let heuristicAdded = 0;
  for (const { cusip, issuerName } of uniquePairs.values()) {
    if (map[cusip]) continue;
    const symbol = matchIssuerToSymbol(issuerName, nameToSymbol, firstTwoWordsIndex);
    const normalized = normalizeSymbolForDb(symbol || "");
    if (normalized && validSymbols.has(normalized)) {
      map[cusip] = normalized;
      heuristicAdded++;
    }
  }

  writeFileSync(CUSIP_MAP_PATH, JSON.stringify(map, null, 0));
  return {
    map,
    stats: {
      totalCusips: uniquePairs.size,
      mappedBefore: uniquePairs.size - unresolvedCusips.length,
      heuristicAdded,
      unresolved: [...uniquePairs.keys()].filter((cusip) => !map[cusip]).length,
    },
  };
}

export { CUSIP_MAP_PATH };
