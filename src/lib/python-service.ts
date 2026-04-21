/**
 * Phase 12B — server-side client for the StockStalker Python microservice (`/news`).
 * Requires PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY (same value as Python INTERNAL_API_KEY).
 */

export type PythonNewsItem = {
  title: string;
  publisher?: string | null;
  published_at?: number | null;
  link?: string | null;
  type?: string | null;
};

export type PythonNewsResponse = {
  data: Record<string, PythonNewsItem[]>;
};

const MAX_TICKERS = 40;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isPythonServiceConfigured(): boolean {
  return Boolean(process.env.PYTHON_SERVICE_URL?.trim() && process.env.PYTHON_SERVICE_KEY?.trim());
}

/**
 * POST /news on the Python service. Call only from server (API routes, crons, RSC).
 */
export async function fetchPythonTickerNews(init: {
  tickers: string[];
  hoursBack?: number;
  signal?: AbortSignal;
}): Promise<PythonNewsResponse> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    throw new Error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set");
  }

  const tickers = [
    ...new Set(
      init.tickers
        .map((t) => String(t).trim().toUpperCase())
        .filter((t) => t.length > 0 && t.length <= 12)
    ),
  ].slice(0, MAX_TICKERS);

  if (tickers.length === 0) {
    return { data: {} };
  }

  const hoursBack =
    init.hoursBack != null && Number.isFinite(init.hoursBack)
      ? Math.min(168, Math.max(1, Math.round(init.hoursBack)))
      : 24;

  const url = `${normalizeBaseUrl(base)}/news`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tickers, hours_back: hoursBack }),
    signal: init.signal,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Python /news HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Python /news: invalid JSON");
  }

  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Python /news: missing data object");
  }

  return { data: data as Record<string, PythonNewsItem[]> };
}
