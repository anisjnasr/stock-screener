import type { MarketMonitorApiPayload } from "@/app/api/market-monitor/route";

/**
 * Shared loader for `/api/market-monitor`.
 *
 * `MarketMonitorTable` and `MarketIndexCards` both need this payload on mount,
 * which previously fired two identical network requests per page load. This
 * dedups concurrent callers onto a single in-flight request and briefly caches
 * the result so the second consumer is served from memory. HTTP caching is left
 * to the browser (the endpoint returns `stale-while-revalidate`), so we no
 * longer force `cache: "no-store"`.
 */
const CACHE_TTL_MS = 20 * 1000;

let inflight: Promise<MarketMonitorApiPayload | null> | null = null;
let resolved: { payload: MarketMonitorApiPayload; expiresAt: number } | null = null;

export function fetchMarketMonitor(): Promise<MarketMonitorApiPayload | null> {
  if (resolved && resolved.expiresAt > Date.now()) {
    return Promise.resolve(resolved.payload);
  }
  if (inflight) return inflight;
  inflight = fetch("/api/market-monitor")
    .then(async (r) => {
      if (!r.ok) return null;
      const json = (await r.json()) as MarketMonitorApiPayload;
      resolved = { payload: json, expiresAt: Date.now() + CACHE_TTL_MS };
      return json;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
