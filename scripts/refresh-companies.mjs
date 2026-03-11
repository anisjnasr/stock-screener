#!/usr/bin/env node
/**
 * Refresh companies table from data/all-stocks.json (weekly cadence).
 * Run: node scripts/refresh-companies.mjs  or  npm run refresh-companies
 * Re-runs seed from current all-stocks.json. Update that file first (build-stocks-db + enrich-stocks).
 */

import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, "seed-companies.mjs");
const r = spawnSync(process.execPath, [seedPath], { stdio: "inherit", cwd: join(__dirname, "..") });
process.exit(r.status ?? 1);
