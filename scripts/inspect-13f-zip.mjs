#!/usr/bin/env node
/**
 * Download one SEC 13F quarterly ZIP and list its contents (file names and first lines).
 * Run: node scripts/inspect-13f-zip.mjs
 * Purpose: discover file/column structure for parsing (plan step 1).
 */

import AdmZip from "adm-zip";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SEC_USER_AGENT, QUARTERS_12 } from "./sec-13f-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_13F = join(root, "data", "13f");

async function download(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  if (!existsSync(DATA_13F)) mkdirSync(DATA_13F, { recursive: true });

  const quarter = QUARTERS_12[QUARTERS_12.length - 1];
  console.log("Downloading", quarter.key, quarter.url);
  const buf = await download(quarter.url);
  const zipPath = join(DATA_13F, `${quarter.key}.zip`);
  writeFileSync(zipPath, buf);
  console.log("Saved", zipPath, buf.length, "bytes");

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  console.log("\nEntries:", entries.length);
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName;
    const data = e.getData();
    const preview = data.toString("utf8", 0, 500).split("\n").slice(0, 5).join("\n");
    console.log("\n---", name, "(", data.length, "bytes ) ---");
    console.log(preview);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
