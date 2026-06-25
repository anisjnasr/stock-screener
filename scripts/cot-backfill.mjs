#!/usr/bin/env node
// Task 3 — one-time COT backfill (~3 years of weekly history).
//
// For each of the six contracts, pulls ~156 weeks from the primary report (TFF or
// Disaggregated) plus Legacy, joins them by report_date, collapses categories into the
// three camps, and upserts into `cot_weekly`. Idempotent: safe to re-run (unique
// constraint on (contract_key, report_date)).
//
// Run:  node scripts/cot-backfill.mjs   (or: npm run cot-backfill)
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
// Optional: CFTC_APP_TOKEN to raise CFTC rate limits.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { root } from "./_db-paths.mjs";
import { CONTRACTS, buildContractRows } from "./cot-shared.mjs";

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnvLocal();

const SINCE = "2023-06-01"; // ~156 weeks back, per spec.
const CHUNK = 200;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
    process.exit(1);
  }
  const token = process.env.CFTC_APP_TOKEN || undefined;
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`COT backfill since ${SINCE} | CFTC token: ${token ? "yes" : "no"}`);

  let grandTotal = 0;
  for (const contract of CONTRACTS) {
    process.stdout.write(`\n${contract.key} (${contract.name}) ... `);
    let rows;
    try {
      rows = await buildContractRows(contract, SINCE, token);
    } catch (err) {
      console.error(`FETCH ERROR: ${err.message}`);
      continue;
    }
    if (!rows.length) {
      console.log("no rows returned (check contract name)");
      continue;
    }

    let upserted = 0;
    let failed = false;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("cot_weekly")
        .upsert(slice, { onConflict: "contract_key,report_date" });
      if (error) {
        console.error(`\n  upsert error (chunk ${i}): ${error.message}`);
        failed = true;
        break;
      }
      upserted += slice.length;
    }
    if (!failed) {
      const withSmall = rows.filter((r) => r.small_spec_long !== null).length;
      console.log(
        `${upserted} weeks (${rows[0].report_date} → ${rows[rows.length - 1].report_date}, small-spec on ${withSmall})`
      );
      grandTotal += upserted;
    }
  }

  console.log(`\n\nVerification — row counts per contract:`);
  for (const contract of CONTRACTS) {
    const { count, error } = await supabase
      .from("cot_weekly")
      .select("*", { count: "exact", head: true })
      .eq("contract_key", contract.key);
    console.log(`  ${contract.key}: ${error ? "ERR " + error.message : count}`);
  }
  console.log(`\nDone. Total weeks upserted this run: ${grandTotal}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
