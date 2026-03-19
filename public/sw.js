/**
 * Stock Stalker Service Worker
 * Provides offline access to previously viewed stocks using a cache-first strategy
 * for API data and a network-first strategy for app shell resources.
 */

const CACHE_VERSION = "ss-v1";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const APP_SHELL_URLS = ["/", "/favicon-32x32.png", "/apple-touch-icon.png"];

const CACHEABLE_API_PATTERNS = [
  /\/api\/stock\?/,
  /\/api\/candles\?/,
  /\/api\/fundamentals\?/,
  /\/api\/ownership\?/,
  /\/api\/related-stocks\?/,
  /\/api\/screener\?/,
  /\/api\/market-monitor/,
  /\/api\/breadth\?/,
  /\/api\/sectors-industries/,
  /\/api\/news\?/,
  /\/api\/profile\?/,
  /\/api\/quote\?/,
];

const DATA_TTL_MS = 30 * 60 * 1000; // 30 minutes

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== APP_SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // Health and perf endpoints should never be cached
  if (url.pathname === "/api/health" || url.pathname === "/api/perf") return;

  const isApiRequest = CACHEABLE_API_PATTERNS.some((pattern) =>
    pattern.test(url.pathname + url.search)
  );

  if (isApiRequest) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // App shell: cache-first
  if (
    url.origin === self.location.origin &&
    (url.pathname === "/" || url.pathname.startsWith("/_next/"))
  ) {
    event.respondWith(cacheFirstWithNetwork(request));
    return;
  }
});

async function networkFirstWithCache(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      const headers = new Headers(clone.headers);
      headers.set("sw-cached-at", String(Date.now()));
      const body = await clone.arrayBuffer();
      const cachedResponse = new Response(body, {
        status: clone.status,
        statusText: clone.statusText,
        headers,
      });
      cache.put(request, cachedResponse);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = Number(cached.headers.get("sw-cached-at") || "0");
      if (Date.now() - cachedAt < DATA_TTL_MS) {
        return cached;
      }
      // Even if stale, return it when offline -- better than nothing
      return cached;
    }
    return new Response(JSON.stringify({ error: "Offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

// Periodic cache cleanup
self.addEventListener("message", (event) => {
  if (event.data === "cleanup-cache") {
    caches.open(DATA_CACHE).then(async (cache) => {
      const keys = await cache.keys();
      const cutoff = Date.now() - DATA_TTL_MS * 4;
      for (const key of keys) {
        const response = await cache.match(key);
        if (response) {
          const cachedAt = Number(response.headers.get("sw-cached-at") || "0");
          if (cachedAt < cutoff) {
            cache.delete(key);
          }
        }
      }
    });
  }
});
