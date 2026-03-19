/**
 * Lightweight in-memory performance monitor for API routes and DB queries.
 * Stores the last N entries in a ring buffer per metric category.
 * No external dependencies -- data lives only in the server process.
 */

type PerfEntry = {
  route: string;
  durationMs: number;
  timestamp: number;
  status?: number;
  meta?: Record<string, unknown>;
};

type PerfBucket = {
  entries: PerfEntry[];
  maxSize: number;
};

const BUCKET_SIZE = 200;

function getStore(): Map<string, PerfBucket> {
  const g = globalThis as typeof globalThis & { __perfStore?: Map<string, PerfBucket> };
  if (!g.__perfStore) g.__perfStore = new Map();
  return g.__perfStore;
}

function getBucket(category: string): PerfBucket {
  const store = getStore();
  let bucket = store.get(category);
  if (!bucket) {
    bucket = { entries: [], maxSize: BUCKET_SIZE };
    store.set(category, bucket);
  }
  return bucket;
}

export function recordPerf(
  category: "api" | "db",
  route: string,
  durationMs: number,
  opts?: { status?: number; meta?: Record<string, unknown> }
) {
  const bucket = getBucket(category);
  bucket.entries.push({
    route,
    durationMs,
    timestamp: Date.now(),
    status: opts?.status,
    meta: opts?.meta,
  });
  if (bucket.entries.length > bucket.maxSize) {
    bucket.entries = bucket.entries.slice(-bucket.maxSize);
  }
}

export function getSnapshot(): {
  api: PerfSummary;
  db: PerfSummary;
  recentSlow: PerfEntry[];
} {
  return {
    api: summarize("api"),
    db: summarize("db"),
    recentSlow: getSlowest(20),
  };
}

type RouteStat = {
  route: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
};

type PerfSummary = {
  totalRequests: number;
  avgMs: number;
  byRoute: RouteStat[];
};

function summarize(category: string): PerfSummary {
  const bucket = getBucket(category);
  const entries = bucket.entries;
  if (entries.length === 0) {
    return { totalRequests: 0, avgMs: 0, byRoute: [] };
  }
  const total = entries.reduce((s, e) => s + e.durationMs, 0);
  const byRoute = new Map<string, number[]>();
  for (const e of entries) {
    if (!byRoute.has(e.route)) byRoute.set(e.route, []);
    byRoute.get(e.route)!.push(e.durationMs);
  }
  const routeStats: RouteStat[] = [];
  for (const [route, durations] of byRoute) {
    durations.sort((a, b) => a - b);
    const len = durations.length;
    routeStats.push({
      route,
      count: len,
      avgMs: Math.round(durations.reduce((s, d) => s + d, 0) / len),
      p50Ms: durations[Math.floor(len * 0.5)] ?? 0,
      p95Ms: durations[Math.floor(len * 0.95)] ?? 0,
      p99Ms: durations[Math.floor(len * 0.99)] ?? 0,
      maxMs: durations[len - 1] ?? 0,
      minMs: durations[0] ?? 0,
    });
  }
  routeStats.sort((a, b) => b.avgMs - a.avgMs);
  return {
    totalRequests: entries.length,
    avgMs: Math.round(total / entries.length),
    byRoute: routeStats,
  };
}

function getSlowest(n: number): PerfEntry[] {
  const store = getStore();
  const all: PerfEntry[] = [];
  for (const bucket of store.values()) {
    all.push(...bucket.entries);
  }
  all.sort((a, b) => b.durationMs - a.durationMs);
  return all.slice(0, n);
}

/**
 * Wrap an API route handler with automatic timing.
 * Usage: export const GET = withPerfMonitoring("/api/screener", handler);
 */
export function withPerfMonitoring<T extends (...args: unknown[]) => Promise<Response>>(
  routeName: string,
  handler: T
): T {
  return (async (...args: unknown[]) => {
    const start = performance.now();
    try {
      const res = await handler(...args);
      const durationMs = Math.round(performance.now() - start);
      recordPerf("api", routeName, durationMs, {
        status: res instanceof Response ? res.status : undefined,
      });
      return res;
    } catch (e) {
      const durationMs = Math.round(performance.now() - start);
      recordPerf("api", routeName, durationMs, { status: 500 });
      throw e;
    }
  }) as T;
}

/**
 * Time a database operation. Returns the result and records the duration.
 */
export function timeDbQuery<T>(queryName: string, fn: () => T): T {
  const start = performance.now();
  try {
    const result = fn();
    recordPerf("db", queryName, Math.round(performance.now() - start));
    return result;
  } catch (e) {
    recordPerf("db", queryName, Math.round(performance.now() - start), {
      meta: { error: e instanceof Error ? e.message : "unknown" },
    });
    throw e;
  }
}
