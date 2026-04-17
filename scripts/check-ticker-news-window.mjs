#!/usr/bin/env node
/**
 * One-off: fetch Polygon /v2/reference/news for a ticker and list items
 * that pass the same ET date window as /api/premarket/catalyst.
 *
 * Usage: node scripts/check-ticker-news-window.mjs CDNA
 * Loads MASSIVE_API_KEY from process.env or .env.local at repo root.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
  }
}

const ET = "America/New_York";

function todayYmdEt(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: ET });
}

function priorTradingSessionYmdEt(now = new Date()) {
  for (let daysBack = 1; daysBack <= 10; daysBack++) {
    const probe = new Date(now.getTime() - daysBack * 86_400_000);
    const wd = probe.toLocaleDateString("en-US", { timeZone: ET, weekday: "short" });
    if (wd !== "Sat" && wd !== "Sun") {
      return probe.toLocaleDateString("en-CA", { timeZone: ET });
    }
  }
  return todayYmdEt(now);
}

function publishedUtcToYmdEt(publishedUtc) {
  const d = new Date(publishedUtc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: ET });
}

function inWindow(publishedUtc, todayYmd, priorYmd) {
  const ymd = publishedUtcToYmdEt(publishedUtc);
  if (!ymd) return false;
  return ymd === todayYmd || ymd === priorYmd;
}

async function main() {
  loadEnvLocal();
  const symbol = (process.argv[2] || "CDNA").toUpperCase();
  const key = process.env.MASSIVE_API_KEY?.trim();
  if (!key) {
    console.error("Set MASSIVE_API_KEY or add it to .env.local");
    process.exit(1);
  }

  const now = new Date();
  const todayYmd = todayYmdEt(now);
  const priorYmd = priorTradingSessionYmdEt(now);

  const u = new URL("https://api.polygon.io/v2/reference/news");
  u.searchParams.set("ticker", symbol);
  const limit = Math.min(100, Math.max(1, Number(process.env.NEWS_LIMIT) || 50));
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("order", "descending");
  u.searchParams.set("sort", "published_utc");
  u.searchParams.set("apiKey", key);

  const res = await fetch(u);
  const text = await res.text();
  if (!res.ok) {
    console.error("HTTP", res.status, text.slice(0, 500));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Invalid JSON", text.slice(0, 200));
    process.exit(1);
  }

  const results = data.results ?? [];
  const sym = symbol;

  const mapped = results
    .map((a) => ({
      title: String(a.title ?? ""),
      published_utc: a.published_utc ?? "",
      article_url: a.article_url ?? "",
      publisher: a.publisher?.name ?? "",
      tickers: (a.tickers ?? []).map((t) => String(t).toUpperCase()),
    }))
    .filter((a) => {
      const tickers = a.tickers;
      return tickers.length === 0 || tickers.includes(sym);
    });

  console.log("Symbol:", symbol);
  console.log("Premarket window (ET dates): today =", todayYmd, "| prior session =", priorYmd);
  console.log("Raw API result count (before ticker filter):", results.length);
  console.log("After ticker filter (same as massive.ts):", mapped.length);
  console.log("");

  const inWin = mapped.filter((a) => inWindow(a.published_utc, todayYmd, priorYmd));
  console.log("In premarket window:", inWin.length);
  console.log("---");

  for (const a of mapped.slice(0, 25)) {
    const ymd = publishedUtcToYmdEt(a.published_utc);
    const ok = inWindow(a.published_utc, todayYmd, priorYmd);
    console.log(
      ok ? "[IN ]" : "[out]",
      ymd,
      a.published_utc,
      "|",
      a.publisher,
      "|",
      a.title.slice(0, 100) + (a.title.length > 100 ? "…" : "")
    );
  }

  if (mapped.length > 25) console.log("…", mapped.length - 25, "more not shown");

  const divest = mapped.filter((a) => /divest|eurobio|170/i.test(a.title));
  if (divest.length) {
    console.log("\nTitles matching divest/eurobio/170 (any window):");
    for (const a of divest) {
      console.log(" ", publishedUtcToYmdEt(a.published_utc), a.title);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
