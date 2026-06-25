#!/usr/bin/env node
// THROWAWAY discovery script for Task 1 of the COT panel build.
// Confirms the exact `contract_market_name` strings for our six contracts
// across the three CFTC datasets, and prints the real column names.
// Safe to delete after the contract-name mapping is confirmed.

const BASE = "https://publicreporting.cftc.gov/resource";

// Pull a recent window so we see only currently-active contract names.
const SINCE = "2026-04-01";

const DATASETS = [
  {
    id: "gpe5-46if",
    name: "TFF (Traders in Financial Futures, Futures-Only)",
    keywords: ["S&P", "NASDAQ", "RUSSELL", "BITCOIN"],
  },
  {
    id: "72hh-3qpy",
    name: "Disaggregated (Futures-Only)",
    keywords: ["GOLD", "CRUDE"],
  },
  {
    id: "6dca-aqww",
    name: "Legacy (Futures-Only)",
    keywords: ["S&P", "NASDAQ", "RUSSELL", "BITCOIN", "GOLD", "CRUDE"],
  },
];

const token = process.env.CFTC_APP_TOKEN;
const headers = token ? { "X-App-Token": token } : {};

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function discoverDataset(ds) {
  console.log("\n" + "=".repeat(78));
  console.log(`DATASET: ${ds.name}  (${ds.id})`);
  console.log("=".repeat(78));

  // 1) Distinct contract names matching our keywords.
  const namesUrl =
    `${BASE}/${ds.id}.json` +
    `?$select=contract_market_name,market_and_exchange_names` +
    `&$where=report_date_as_yyyy_mm_dd > '${SINCE}'` +
    `&$limit=5000`;

  const rows = await getJson(namesUrl);

  const seen = new Map();
  for (const r of rows) {
    const cmn = r.contract_market_name ?? "";
    const men = r.market_and_exchange_names ?? "";
    const hay = `${cmn} ${men}`.toUpperCase();
    for (const kw of ds.keywords) {
      if (hay.includes(kw.toUpperCase())) {
        const key = `${cmn} || ${men}`;
        if (!seen.has(key)) seen.set(key, kw);
      }
    }
  }

  console.log(`\nMatching contracts (since ${SINCE}):`);
  if (seen.size === 0) {
    console.log("  (none found — widen the date window or check keywords)");
  } else {
    const grouped = {};
    for (const [key, kw] of seen) (grouped[kw] ??= []).push(key);
    for (const kw of ds.keywords) {
      if (!grouped[kw]) continue;
      console.log(`\n  [${kw}]`);
      for (const k of grouped[kw]) {
        const [cmn, men] = k.split(" || ");
        console.log(`    contract_market_name   : ${cmn}`);
        console.log(`    market_and_exchange    : ${men}`);
      }
    }
  }

  // 2) All keys of one sample row to confirm real column spellings.
  const sampleUrl =
    `${BASE}/${ds.id}.json` +
    `?$where=report_date_as_yyyy_mm_dd > '${SINCE}'` +
    `&$order=report_date_as_yyyy_mm_dd DESC` +
    `&$limit=1`;
  const sample = await getJson(sampleUrl);
  console.log(`\nSample row column names (${ds.id}):`);
  if (sample.length === 0) {
    console.log("  (no rows returned)");
  } else {
    console.log("  " + Object.keys(sample[0]).sort().join("\n  "));
  }
}

async function main() {
  console.log(`CFTC COT discovery — app token: ${token ? "yes" : "no (anonymous)"}`);
  for (const ds of DATASETS) {
    try {
      await discoverDataset(ds);
    } catch (err) {
      console.error(`\nERROR on ${ds.name}: ${err.message}`);
    }
  }
  console.log("\nDone.");
}

main();
