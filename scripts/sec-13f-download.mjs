/**
 * Download SEC Form 13F quarterly ZIPs. Uses User-Agent per SEC policy.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { SEC_USER_AGENT, SEC_13F_DATASET_BASE_URL, SEC_13F_DATASET_INDEX_URL } from "./sec-13f-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_13F = join(root, "data", "13f");
const MONTH_TO_INDEX = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export const DATA_13F_DIR = DATA_13F;

function formatQuarterReportDate(year, quarterNum) {
  if (quarterNum === 1) return `${year}-03-31`;
  if (quarterNum === 2) return `${year}-06-30`;
  if (quarterNum === 3) return `${year}-09-30`;
  return `${year}-12-31`;
}

function parseQuarterFromEndMonth(endMonth, endYear) {
  if (endMonth === 5) return { year: endYear, quarterNum: 1 };
  if (endMonth === 8) return { year: endYear, quarterNum: 2 };
  if (endMonth === 11) return { year: endYear, quarterNum: 3 };
  if (endMonth === 2) return { year: endYear - 1, quarterNum: 4 };
  return null;
}

export function inferQuarterFromDatasetName(datasetName) {
  const cleaned = String(datasetName || "").trim().toLowerCase();
  if (!cleaned.endsWith("_form13f.zip")) return null;

  const qMatch = cleaned.match(/^(\d{4})q([1-4])_form13f\.zip$/);
  if (qMatch) {
    const year = Number(qMatch[1]);
    const quarterNum = Number(qMatch[2]);
    return {
      key: `${year}q${quarterNum}`,
      reportDate: formatQuarterReportDate(year, quarterNum),
    };
  }

  const rangeMatch = cleaned.match(/^(\d{2})([a-z]{3})(\d{4})-(\d{2})([a-z]{3})(\d{4})_form13f\.zip$/);
  if (!rangeMatch) return null;
  const endMonth = MONTH_TO_INDEX[rangeMatch[5]];
  const endYear = Number(rangeMatch[6]);
  if (!endMonth || !Number.isFinite(endYear)) return null;
  const q = parseQuarterFromEndMonth(endMonth, endYear);
  if (!q) return null;
  return {
    key: `${q.year}q${q.quarterNum}`,
    reportDate: formatQuarterReportDate(q.year, q.quarterNum),
  };
}

function sortByQuarterDesc(a, b) {
  const d = String(b.reportDate || "").localeCompare(String(a.reportDate || ""));
  if (d !== 0) return d;
  return String(b.key || "").localeCompare(String(a.key || ""));
}

/**
 * Discover all published SEC 13F quarter datasets and normalize to quarter metadata.
 */
export async function listAvailableQuarters() {
  const res = await fetch(SEC_13F_DATASET_INDEX_URL, {
    headers: { "User-Agent": SEC_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`SEC 13F listing failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const matches = [...html.matchAll(/href="([^"]+_form13f\.zip)"/gi)];
  const byKey = new Map();
  for (const m of matches) {
    const href = String(m[1] || "").trim();
    if (!href) continue;
    const fileName = basename(href);
    const quarter = inferQuarterFromDatasetName(fileName);
    if (!quarter) continue;
    const url = href.startsWith("http")
      ? href
      : `${SEC_13F_DATASET_BASE_URL}${fileName}`;
    const existing = byKey.get(quarter.key);
    if (!existing || String(url) > String(existing.url)) {
      byKey.set(quarter.key, { ...quarter, url });
    }
  }
  return [...byKey.values()].sort(sortByQuarterDesc);
}

/**
 * Read quarter ZIPs already present in data/13f and infer quarter metadata from file names.
 */
export function listLocalQuarterZips() {
  if (!existsSync(DATA_13F)) return [];
  const files = readdirSync(DATA_13F).filter((f) => f.toLowerCase().endsWith(".zip"));
  const byKey = new Map();
  for (const fileName of files) {
    const base = fileName.slice(0, -4);
    const quarter = inferQuarterFromDatasetName(base.endsWith("_form13f") ? `${base}.zip` : `${base}_form13f.zip`);
    if (!quarter) continue;
    const path = join(DATA_13F, fileName);
    byKey.set(quarter.key, { quarter, path });
  }
  return [...byKey.values()].sort((a, b) => sortByQuarterDesc(a.quarter, b.quarter));
}

/**
 * Download one ZIP to data/13f/{key}.zip. Returns path.
 */
export async function downloadQuarter(quarter, opts = {}) {
  const { key, url } = quarter;
  if (!existsSync(DATA_13F)) mkdirSync(DATA_13F, { recursive: true });
  const outPath = join(DATA_13F, `${key}.zip`);
  if (opts.skipExisting && existsSync(outPath)) return outPath;

  const res = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT },
  });
  if (!res.ok) throw new Error(`SEC 13F download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  return outPath;
}

/**
 * Ensure selected quarters are downloaded. Accepts a count or explicit quarter list.
 */
export async function ensureQuartersDownloaded(target = 12) {
  const toFetch = Array.isArray(target)
    ? target
    : (await listAvailableQuarters()).slice(0, Math.max(1, target));
  const paths = [];
  for (let i = 0; i < toFetch.length; i++) {
    const q = toFetch[i];
    const path = await downloadQuarter(q, { skipExisting: true });
    paths.push({ quarter: q, path });
  }
  return paths;
}

export { SEC_USER_AGENT };
