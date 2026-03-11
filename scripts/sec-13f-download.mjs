/**
 * Download SEC Form 13F quarterly ZIPs. Uses User-Agent per SEC policy.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SEC_USER_AGENT, QUARTERS_12 } from "./sec-13f-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_13F = join(root, "data", "13f");

export const DATA_13F_DIR = DATA_13F;

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
 * Ensure the last N quarters are downloaded. Returns paths.
 */
export async function ensureQuartersDownloaded(n = 12) {
  const toFetch = QUARTERS_12.slice(0, n);
  const paths = [];
  for (let i = 0; i < toFetch.length; i++) {
    const q = toFetch[i];
    const path = await downloadQuarter(q, { skipExisting: true });
    paths.push({ quarter: q, path });
  }
  return paths;
}

export { QUARTERS_12, SEC_USER_AGENT };
