"use client";

type BreadthPoint = {
  date: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
};

type NetNewHighPoint = { date: string; highs: number; lows: number; net: number };

export type BreadthClientResponse = {
  indexId: "sp500" | "nasdaq";
  latestDate?: string | null;
  startDate?: string | null;
  breadth: BreadthPoint[];
  netNewHighs?: {
    oneMonth: NetNewHighPoint[];
    threeMonths: NetNewHighPoint[];
    sixMonths: NetNewHighPoint[];
    fiftyTwoWeek: NetNewHighPoint[];
  };
};

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: BreadthClientResponse;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<BreadthClientResponse | null>>();

function keyFor(indexId: string, includeNetNewHighs: boolean): string {
  return `${indexId}:${includeNetNewHighs ? "full" : "breadth"}`;
}

function getCached(key: string): BreadthClientResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: BreadthClientResponse) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function fetchBreadthClient(
  indexId: "sp500" | "nasdaq",
  opts?: { includeNetNewHighs?: boolean }
): Promise<BreadthClientResponse | null> {
  const includeNetNewHighs = Boolean(opts?.includeNetNewHighs);
  const key = keyFor(indexId, includeNetNewHighs);
  const fullKey = keyFor(indexId, true);

  const directCached = getCached(key);
  if (directCached) return directCached;
  if (!includeNetNewHighs) {
    const fullCached = getCached(fullKey);
    if (fullCached) return fullCached;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;
  if (!includeNetNewHighs) {
    const fullExisting = inFlight.get(fullKey);
    if (fullExisting) return fullExisting;
  }

  const run = async (): Promise<BreadthClientResponse | null> => {
    try {
      const params = new URLSearchParams({ index: indexId });
      if (!includeNetNewHighs) params.set("view", "breadth");
      const res = await fetch(`/api/breadth?${params.toString()}`);
      if (!res.ok) return null;
      const data = (await res.json()) as BreadthClientResponse;
      setCached(key, data);
      if (includeNetNewHighs) setCached(fullKey, data);
      return data;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  };

  const task = run();
  inFlight.set(key, task);
  return task;
}

