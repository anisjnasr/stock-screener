/**
 * EASTERN calendar day keyed snapshots for live SIP lists (persist across reload).
 */
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";

export type SipPersistVariant = "mid-large" | "small-cap";

export type SipDaySnapshotV1 = {
  v: 1;
  etYmd: string;
  savedAtMs: number;
  rows: GapperRow[];
  news: Record<string, PythonNewsItem[]> | null;
  catalyst: Record<string, SipCatalyst> | null;
  newsError: string | null;
  catalystError: string | null;
  pythonConfigured: boolean;
};

function storageKey(etYmd: string, variant: SipPersistVariant): string {
  return variant === "mid-large"
    ? `stockstalker-sip-day-mid-large-v1-${etYmd}`
    : `stockstalker-sip-day-small-cap-v1-${etYmd}`;
}

export function loadSipDaySnapshot(etYmd: string, variant: SipPersistVariant): SipDaySnapshotV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(etYmd, variant));
    if (!raw) return null;
    const j = JSON.parse(raw) as SipDaySnapshotV1;
    if (!j || j.v !== 1 || j.etYmd !== etYmd || !Array.isArray(j.rows)) return null;
    return j;
  } catch {
    return null;
  }
}

export function saveSipDaySnapshot(snapshot: SipDaySnapshotV1, variant: SipPersistVariant): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(snapshot.etYmd, variant), JSON.stringify(snapshot));
  } catch {
    /* quota */
  }
}

function gapSortValue(row: GapperRow): number {
  return Number.isFinite(row.gapPct) ? row.gapPct : Number.NEGATIVE_INFINITY;
}

/**
 * Merge mid-large rows by ticker:
 * - keep accumulated names (never drop previous rows if absent in current refresh)
 * - refresh existing rows with latest API values when present
 * - append new names
 * - always sort by latest Gap % descending
 */
export function mergeMidLargeRows(previous: GapperRow[], apiRows: GapperRow[]): GapperRow[] {
  const previousByTicker = new Map(previous.map((r) => [r.ticker.toUpperCase(), r]));
  const seen = new Set<string>();
  const out: GapperRow[] = [];

  for (const api of apiRows) {
    const u = api.ticker.toUpperCase();
    seen.add(u);
    // Latest API snapshot should override stale values like gapPct/pmVolume.
    out.push({ ...(previousByTicker.get(u) ?? {}), ...api });
  }

  for (const prev of previous) {
    const u = prev.ticker.toUpperCase();
    if (!seen.has(u)) out.push(prev);
  }

  return out.sort((a, b) => gapSortValue(b) - gapSortValue(a));
}

/** Shallow merge; `next` wins on key collisions (latest API overlay). */
export function mergeKeyedRecords<T>(
  prev: Record<string, T> | null | undefined,
  next: Record<string, T> | null | undefined
): Record<string, T> | null {
  const combined = { ...(prev ?? {}), ...(next ?? {}) };
  return Object.keys(combined).length ? combined : null;
}

export function snapshotFromSuccess(
  etYmd: string,
  rows: GapperRow[],
  json: StocksInPlaySuccess
): SipDaySnapshotV1 {
  return {
    v: 1,
    etYmd,
    savedAtMs: Date.now(),
    rows,
    news: json.news ?? null,
    catalyst: json.catalyst ?? null,
    newsError: json.newsError ?? null,
    catalystError: json.catalystError ?? null,
    pythonConfigured: json.pythonConfigured,
  };
}
