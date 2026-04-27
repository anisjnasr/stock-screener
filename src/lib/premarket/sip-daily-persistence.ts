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

/** Merge mid-large: keep existing order and rows; append API rows whose tickers are new. */
export function mergeMidLargeRows(previous: GapperRow[], apiRows: GapperRow[]): GapperRow[] {
  const seen = new Set(previous.map((r) => r.ticker.toUpperCase()));
  const out = [...previous];
  for (const r of apiRows) {
    const u = r.ticker.toUpperCase();
    if (!seen.has(u)) {
      seen.add(u);
      out.push(r);
    }
  }
  return out;
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
