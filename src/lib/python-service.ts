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

/** Must match StockStalker Python `POST /news` validation (HTTP 400 if exceeded). */
const MAX_TICKERS_PER_NEWS_REQUEST = 40;
/** Upper bound on total symbols fetched across all batches (SIP + cost control). */
const MAX_TICKERS_TOTAL = 120;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function postPythonNewsOnce(
  url: string,
  key: string,
  tickers: string[],
  hoursBack: number,
  signal: AbortSignal | undefined
): Promise<Record<string, PythonNewsItem[]>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tickers, hours_back: hoursBack }),
    signal,
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

  return data as Record<string, PythonNewsItem[]>;
}

export function isPythonServiceConfigured(): boolean {
  return Boolean(process.env.PYTHON_SERVICE_URL?.trim() && process.env.PYTHON_SERVICE_KEY?.trim());
}

/** Mirrors Python `premarket_snapshot` body field — Massive snapshot row mapped in TS. */
export type LargeCapPremarketSnapshotForPython = {
  last_price: number;
  prev_close_from_snapshot: number;
  gap_pct: number;
  pm_volume: number;
  avg_volume_baseline_shares: number | null;
};

export type PythonLargeCapDigestResponse = {
  ok: boolean;
  digest?: Record<string, unknown>;
  error?: string | null;
};

export type PythonLargeCapAnalyzeResponse = {
  ok: boolean;
  cache_hit?: boolean;
  claude_call_made?: boolean;
  digest_hash?: string | null;
  trading_date?: string | null;
  data_mode?: string | null;
  analyzed_at?: string | null;
  digest?: Record<string, unknown>;
  verdict?: Record<string, unknown>;
  archive_written?: boolean;
  error?: string | null;
};

/**
 * POST `/large-cap/analyze` — digest + Supabase hash cache + Claude on miss.
 */
export async function fetchPythonLargeCapAnalyze(init: {
  profileId: string;
  ticker: string;
  dataMode: "historical" | "historical_premarket";
  analysisDate?: string | null;
  dbLatestCompletedDate?: string | null;
  premarketSnapshot?: LargeCapPremarketSnapshotForPython | null;
  forceRefresh?: boolean;
  model?: string | null;
  signal?: AbortSignal;
}): Promise<PythonLargeCapAnalyzeResponse> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    throw new Error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set");
  }

  const ticker = String(init.ticker).trim().toUpperCase();
  const profileId = String(init.profileId).trim();
  if (!ticker) throw new Error("ticker is required");
  if (!profileId) throw new Error("profileId is required");

  const url = `${normalizeBaseUrl(base)}/large-cap/analyze`;
  const body: Record<string, unknown> = {
    profile_id: profileId,
    ticker,
    data_mode: init.dataMode,
    analysis_date: init.analysisDate ?? null,
    db_latest_completed_date: init.dbLatestCompletedDate ?? null,
    force_refresh: Boolean(init.forceRefresh),
    model: init.model ?? null,
  };
  if (init.premarketSnapshot != null) {
    body.premarket_snapshot = init.premarketSnapshot;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init.signal,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Python /large-cap/analyze: invalid JSON (${res.status})`);
  }

  const obj = parsed as PythonLargeCapAnalyzeResponse & { detail?: string };
  if (!res.ok) {
    throw new Error(
      `Python /large-cap/analyze HTTP ${res.status}: ${obj.detail || obj.error || text.slice(0, 400)}`
    );
  }
  if (!obj.ok) {
    throw new Error(obj.error || "Python /large-cap/analyze returned ok=false");
  }
  return obj;
}

/**
 * POST `/large-cap/digest` on the Python service (server-only).
 */
export async function fetchPythonLargeCapDigest(init: {
  ticker: string;
  dataMode: "historical" | "historical_premarket";
  analysisDate?: string | null;
  dbLatestCompletedDate?: string | null;
  premarketSnapshot?: LargeCapPremarketSnapshotForPython | null;
  signal?: AbortSignal;
}): Promise<PythonLargeCapDigestResponse> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    throw new Error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set");
  }

  const ticker = String(init.ticker).trim().toUpperCase();
  if (!ticker) {
    throw new Error("ticker is required");
  }

  const url = `${normalizeBaseUrl(base)}/large-cap/digest`;
  const body: Record<string, unknown> = {
    ticker,
    data_mode: init.dataMode,
    analysis_date: init.analysisDate ?? null,
    db_latest_completed_date: init.dbLatestCompletedDate ?? null,
  };
  if (init.premarketSnapshot != null) {
    body.premarket_snapshot = init.premarketSnapshot;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init.signal,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Python /large-cap/digest: invalid JSON (${res.status})`);
  }

  const obj = parsed as PythonLargeCapDigestResponse & { detail?: string };
  if (!res.ok) {
    throw new Error(
      `Python /large-cap/digest HTTP ${res.status}: ${obj.detail || text.slice(0, 400)}`
    );
  }
  if (!obj.ok) {
    throw new Error(obj.error || "Python /large-cap/digest returned ok=false");
  }
  return obj;
}

export type LargeCapRunStreamInit = {
  profileId: string;
  tickers: string[];
  dataMode: "historical" | "historical_premarket";
  analysisDate?: string | null;
  dbLatestCompletedDate?: string | null;
  premarketSnapshots?: Record<string, LargeCapPremarketSnapshotForPython> | null;
  forceRefresh?: boolean;
  concurrency?: number;
  model?: string | null;
  signal?: AbortSignal;
};

/**
 * POST `/large-cap/run` — NDJSON stream of batch analyze events (stage 7).
 */
export async function streamPythonLargeCapRun(init: LargeCapRunStreamInit): Promise<Response> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    throw new Error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set");
  }

  const profileId = String(init.profileId).trim();
  const tickers = [
    ...new Set(
      init.tickers
        .map((t) => String(t).trim().toUpperCase())
        .filter((t) => t.length > 0 && t.length <= 12)
    ),
  ];
  if (!profileId) throw new Error("profileId is required");
  if (tickers.length === 0) throw new Error("tickers is required");

  const url = `${normalizeBaseUrl(base)}/large-cap/run`;
  const body: Record<string, unknown> = {
    profile_id: profileId,
    tickers,
    data_mode: init.dataMode,
    analysis_date: init.analysisDate ?? null,
    db_latest_completed_date: init.dbLatestCompletedDate ?? null,
    force_refresh: Boolean(init.forceRefresh),
    model: init.model ?? null,
  };
  if (init.concurrency != null) {
    body.concurrency = init.concurrency;
  }
  if (init.premarketSnapshots && Object.keys(init.premarketSnapshots).length > 0) {
    body.premarket_snapshots = init.premarketSnapshots;
  }

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init.signal,
    cache: "no-store",
  });
}

export type PythonLargeCapArchiveRow = {
  ticker: string;
  trading_date: string;
  result_json: Record<string, unknown>;
  outcome: string | null;
  scoring_json: Record<string, unknown> | null;
  scored: boolean;
  outcome_scored_at: string | null;
  logged_at: string;
  updated_at: string;
};

export async function fetchPythonLargeCapArchiveList(init: {
  profileId: string;
  ticker?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  outcome?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PythonLargeCapArchiveRow[]> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    throw new Error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set");
  }

  const profileId = String(init.profileId).trim();
  if (!profileId) throw new Error("profileId is required");

  const url = `${normalizeBaseUrl(base)}/large-cap/archive/list`;
  const body: Record<string, unknown> = {
    profile_id: profileId,
    ticker: init.ticker ?? null,
    date_from: init.dateFrom ?? null,
    date_to: init.dateTo ?? null,
    outcome: init.outcome ?? null,
    limit: init.limit ?? 500,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init.signal,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Python /large-cap/archive/list HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Python /large-cap/archive/list: invalid JSON");
  }

  const rows = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error("Python /large-cap/archive/list: missing rows array");
  }
  return rows as PythonLargeCapArchiveRow[];
}

export type PythonLargeCapCacheHydrateRow = {
  ticker: string;
  cache_hit: boolean;
  analyzed_at?: string;
  digest?: Record<string, unknown>;
  verdict?: Record<string, unknown>;
};

export async function fetchPythonLargeCapCacheHydrate(init: {
  profileId: string;
  tickers: string[];
  dataMode: "historical" | "historical_premarket";
  analysisDate?: string | null;
  dbLatestCompletedDate?: string | null;
  premarketSnapshots?: Record<string, LargeCapPremarketSnapshotForPython> | null;
  signal?: AbortSignal;
}): Promise<PythonLargeCapCacheHydrateRow[]> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    throw new Error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set");
  }

  const profileId = String(init.profileId).trim();
  if (!profileId) throw new Error("profileId is required");
  const tickers = [
    ...new Set(
      init.tickers
        .map((t) => String(t).trim().toUpperCase())
        .filter((t) => t.length > 0 && t.length <= 12)
    ),
  ];
  if (tickers.length === 0) return [];

  const url = `${normalizeBaseUrl(base)}/large-cap/cache/hydrate`;
  const body: Record<string, unknown> = {
    profile_id: profileId,
    tickers,
    data_mode: init.dataMode,
    analysis_date: init.analysisDate ?? null,
    db_latest_completed_date: init.dbLatestCompletedDate ?? null,
  };
  if (init.premarketSnapshots && Object.keys(init.premarketSnapshots).length > 0) {
    body.premarket_snapshots = init.premarketSnapshots;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init.signal,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Python /large-cap/cache/hydrate HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Python /large-cap/cache/hydrate: invalid JSON");
  }

  const rows = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error("Python /large-cap/cache/hydrate: missing rows array");
  }
  return rows as PythonLargeCapCacheHydrateRow[];
}

/**
 * POST /news on the Python service. Call only from server (API routes, crons, RSC).
 * Sends tickers in chunks of {@link MAX_TICKERS_PER_NEWS_REQUEST} and merges `data`.
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
  ].slice(0, MAX_TICKERS_TOTAL);

  if (tickers.length === 0) {
    return { data: {} };
  }

  const hoursBack =
    init.hoursBack != null && Number.isFinite(init.hoursBack)
      ? Math.min(168, Math.max(1, Math.round(init.hoursBack)))
      : 24;

  const url = `${normalizeBaseUrl(base)}/news`;
  const merged: Record<string, PythonNewsItem[]> = {};

  for (let i = 0; i < tickers.length; i += MAX_TICKERS_PER_NEWS_REQUEST) {
    const batch = tickers.slice(i, i + MAX_TICKERS_PER_NEWS_REQUEST);
    const part = await postPythonNewsOnce(url, key, batch, hoursBack, init.signal);
    for (const [sym, items] of Object.entries(part)) {
      merged[sym] = items;
    }
  }

  return { data: merged };
}
