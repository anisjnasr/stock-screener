#!/usr/bin/env node
/** Production smoke tests for Large Cap Analysis (stages 7–12). */

const BASE = process.env.SMOKE_BASE_URL ?? "https://stock-screener-orfz.onrender.com";
const PROFILE = process.env.SMOKE_PROFILE_ID ?? "9d92b124-d4b5-4292-be9f-6f7530ea1621";
const TICKER = process.env.SMOKE_TICKER ?? "AAPL";

async function postJson(path, body, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { status: res.status, json, headers: res.headers };
}

async function consumeRunStream(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  const events = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { status: res.status, events };
}

function ok(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

let failed = 0;
function check(label, pass, detail) {
  if (!ok(label, pass, detail)) failed += 1;
}

console.log(`Smoke target: ${BASE}`);
console.log(`Profile: ${PROFILE}  Ticker: ${TICKER}\n`);

// 1. Health
try {
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(120_000) });
  check("Main /api/health", health.ok, `HTTP ${health.status}`);
} catch (e) {
  check("Main /api/health", false, String(e.message ?? e));
}

// 2. Digest historical
const d1 = await postJson("/api/large-cap/digest", { ticker: TICKER, data_mode: "historical" });
check(
  "Digest historical",
  d1.status === 200 && d1.json.ok === true,
  d1.json.error ?? `HTTP ${d1.status}`
);

// 3. Digest premarket mode
const d2 = await postJson("/api/large-cap/digest", {
  ticker: TICKER,
  data_mode: "historical_premarket",
});
const pm = d2.json?.digest?.premarket;
check(
  "Digest historical_premarket",
  d2.status === 200 && d2.json.ok === true,
  d2.json.error ?? `pm=${pm?.last_price ?? "null"} HTTP ${d2.status}`
);

// 4. Analyze single (may cache-hit)
const a1 = await postJson("/api/large-cap/analyze", {
  profile_id: PROFILE,
  ticker: TICKER,
  data_mode: "historical",
});
check(
  "Analyze historical",
  a1.status === 200 && a1.json.ok === true,
  `verdict=${a1.json.verdict?.verdict} cache_hit=${a1.json.cache_hit} HTTP ${a1.status} ${a1.json.error ?? ""}`.trim()
);

// 5. Archive list
const ar = await postJson("/api/large-cap/archive", { profile_id: PROFILE });
check(
  "Archive list",
  ar.status === 200 && ar.json.ok === true && Array.isArray(ar.json.rows),
  `rows=${ar.json.rows?.length ?? "?"} HTTP ${ar.status} ${ar.json.error ?? ""}`.trim()
);

// 6. Batch run (1 ticker, both modes)
for (const mode of ["historical", "historical_premarket"]) {
  const run = await consumeRunStream("/api/large-cap/run", {
    profile_id: PROFILE,
    tickers: [TICKER],
    data_mode: mode,
    concurrency: 1,
  });
  const types = run.events.map((e) => e.type);
  const row = run.events.find((e) => e.type === "row_result");
  const complete = run.events.find((e) => e.type === "run_complete");
  check(
    `Run ${mode}`,
    run.status === 200 && types.includes("run_complete") && row?.ok === true,
    `events=${types.join(",")} verdict=${row?.verdict?.verdict} cache=${row?.cache_hit} errors=${complete?.error_count}`
  );
}

console.log(`\n${failed === 0 ? "All smoke checks passed." : `${failed} check(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
