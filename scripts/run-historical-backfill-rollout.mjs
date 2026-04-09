#!/usr/bin/env node
/**
 * Staged rollout helper for Historical Database / Backfill (see MODEL-TASK-GROUPS.md).
 *
 * Default: audit baseline → backfill dollar_volume on daily_bars → validate gates.
 * Use --compute-indicators to run full indicator recompute after dollar volume (long-running).
 *
 * Usage:
 *   node scripts/run-historical-backfill-rollout.mjs
 *   node scripts/run-historical-backfill-rollout.mjs --compute-indicators
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function runStep(name, args) {
  console.error(`\n--- ${name} ---\n`);
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\nStep failed: ${name} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const COMPUTE = process.argv.includes("--compute-indicators");

runStep("audit-financial-baseline", ["scripts/audit-financial-baseline.mjs"]);
runStep("backfill-dollar-volume", ["scripts/backfill-dollar-volume-from-bars.mjs"]);

if (COMPUTE) {
  runStep("compute-indicators-from-bars", ["scripts/compute-indicators-from-bars.mjs"]);
  runStep("recompute-industry-sector-ranks", ["scripts/recompute-industry-sector-ranks.mjs"]);
}

runStep("validate-historical-backfill", ["scripts/validate-historical-backfill.mjs"]);

console.error("\n--- All rollout steps completed successfully. ---\n");
