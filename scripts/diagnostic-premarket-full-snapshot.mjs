#!/usr/bin/env node
/**
 * Diagnostic: full-market snapshot with NO tickers= filter (Polygon returns ~full universe).
 * Run during pre-market hours on Starter to see if day/min/lastTrade reflect current session.
 *
 *   node --env-file=.env.local scripts/diagnostic-premarket-full-snapshot.mjs
 */
const BASE = "https://api.polygon.io";
const key = process.env.MASSIVE_API_KEY;
if (!key) {
  console.error("Missing MASSIVE_API_KEY (use node --env-file=.env.local …)");
  process.exit(1);
}
const url = `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${encodeURIComponent(key)}`;
const res = await fetch(url);
const text = await res.text();
if (!res.ok) {
  console.error("HTTP", res.status, text.slice(0, 600));
  process.exit(1);
}
const data = JSON.parse(text);
const tickers = data.tickers ?? [];
const t =
  tickers.find((x) => x.lastTrade?.p != null || (x.day?.v ?? 0) > 0 || (x.min?.v ?? 0) > 0) ??
  tickers[0];
console.log("response status field:", data.status, "| HTTP OK | tickers returned:", tickers.length);
if (t) {
  console.log("sample:", t.ticker, JSON.stringify({ day: t.day, min: t.min, lastTrade: t.lastTrade, prevDay: t.prevDay }));
}
