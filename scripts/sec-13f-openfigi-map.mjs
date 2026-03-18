/**
 * OpenFIGI resolver for CUSIP -> ticker mapping.
 * Uses a local cache file to avoid re-querying known CUSIPs.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const OPENFIGI_CACHE_PATH = join(DATA_DIR, "cusip-openfigi-cache.json");

function loadOpenFigiCache() {
  if (!existsSync(OPENFIGI_CACHE_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(OPENFIGI_CACHE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveOpenFigiCache(cache) {
  try {
    writeFileSync(OPENFIGI_CACHE_PATH, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSymbolForDb(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[./\s]+/g, "-");
}

function pickBestCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const scored = candidates
    .map((c) => {
      const ticker = normalizeSymbolForDb(c?.ticker || "");
      if (!ticker) return null;
      let score = 0;
      const exch = String(c?.exchCode || "").toUpperCase();
      const msec = String(c?.marketSector || "").toUpperCase();
      const secType = String(c?.securityType2 || c?.securityType || "").toUpperCase();
      if (msec === "EQUITY") score += 8;
      if (exch && /^(US|UN|UW|UQ|UR|UA|NYS|ASE|NAS|ARCX|BATS)$/.test(exch)) score += 5;
      if (secType.includes("COMMON")) score += 4;
      if (secType.includes("ETF")) score += 4;
      if (secType.includes("ADR")) score -= 2;
      return { ticker, score, raw: c };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

/**
 * Resolve CUSIPs through OpenFIGI mapping API.
 * Returns map cusip -> { symbol, source, updated_at } for resolved entries only.
 */
export async function resolveCusipsViaOpenFigi(cusips, opts = {}) {
  const apiKey = String(opts.apiKey || process.env.OPENFIGI_API_KEY || "").trim();
  const userAgent = String(opts.userAgent || process.env.OPENFIGI_USER_AGENT || "stock-scanner admin@localhost");
  const batchSize = Math.max(1, Math.min(apiKey ? 100 : 10, Number(opts.batchSize || (apiKey ? 80 : 8))));
  const cache = loadOpenFigiCache();
  const out = {};
  const unresolved = [];

  for (const raw of cusips) {
    const cusip = String(raw || "").trim().replace(/\s/g, "");
    if (!cusip || cusip.length !== 9) continue;
    const cached = cache[cusip];
    if (cached?.symbol) {
      out[cusip] = cached;
      continue;
    }
    unresolved.push(cusip);
  }

  if (unresolved.length === 0) {
    return { map: out, cacheHits: Object.keys(out).length, requested: 0, resolved: 0 };
  }

  for (let i = 0; i < unresolved.length; i += batchSize) {
    const chunk = unresolved.slice(i, i + batchSize);
    const body = chunk.map((cusip) => ({
      idType: "ID_CUSIP",
      idValue: cusip,
    }));
    let response;
    try {
      response = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": userAgent,
          ...(apiKey ? { "X-OPENFIGI-APIKEY": apiKey } : {}),
        },
        body: JSON.stringify(body),
      });
      if (response.status === 429) {
        const resetHeader = Number(response.headers.get("ratelimit-reset") || 2);
        const waitMs = Number.isFinite(resetHeader) && resetHeader > 0 ? resetHeader * 1000 : 2000;
        await sleep(waitMs);
        i -= batchSize;
        continue;
      }
      if (!response.ok) {
        await sleep(400);
        continue;
      }
      const payload = await response.json();
      for (let j = 0; j < chunk.length; j++) {
        const cusip = chunk[j];
        const rec = payload?.[j];
        const best = pickBestCandidate(rec?.data || []);
        if (!best?.ticker) continue;
        const entry = {
          symbol: best.ticker,
          source: "openfigi",
          updated_at: new Date().toISOString(),
        };
        out[cusip] = entry;
        cache[cusip] = entry;
      }
      await sleep(apiKey ? 260 : 1200);
    } catch {
      await sleep(500);
    }
  }

  saveOpenFigiCache(cache);
  const resolved = Object.keys(out).length;
  return {
    map: out,
    cacheHits: resolved - (unresolved.length - unresolved.filter((c) => out[c]).length),
    requested: unresolved.length,
    resolved: unresolved.filter((c) => !!out[c]).length,
  };
}

export { OPENFIGI_CACHE_PATH, normalizeSymbolForDb };

