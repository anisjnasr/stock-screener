import { DateTime } from "luxon";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";
import { SIP_MAX_TICKERS, SIP_SMALL_CAP_MAX_TICKERS } from "@/lib/premarket/sip-constants";
import {
  loadSipDaySnapshot,
  type SipDaySnapshotV1,
  type SipPersistVariant,
} from "@/lib/premarket/sip-daily-persistence";

export const SIP_ARCHIVE_LS_KEY = "stockstalker-sip-archive-v1";

/** @deprecated Snapshot key no longer written; kept for reading old data. */
export const SIP_ARCHIVE_SNAPSHOT_LS_KEY = "stockstalker-sip-archive-snapshot-v1";

const MAX_ENTRIES = 120;
/** Safety cap on ticker lists / detail rows stored per archive row. */
const ARCHIVE_TICKER_SOFT_CAP = 200;

export type SipArchiveDayDetail = {
  rows: GapperRow[];
  news: Record<string, PythonNewsItem[]> | null;
  catalyst: Record<string, SipCatalyst> | null;
  pythonConfigured: boolean;
  newsError?: string | null;
  catalystError?: string | null;
  catalystSkipped?: boolean;
};

export type SipSipVariant = "mid-large" | "small-cap";

export type SipArchiveEntry = {
  /** Legacy UAE / display key for v1–v2; v3 duplicates archiveDayEt for sort fallbacks. */
  uaeYmd: string;
  tickers: string[];
  detail?: SipArchiveDayDetail | null;
  /** Eastern date (yyyy-MM-dd) when this row was produced by 2am UAE archiver. */
  archiveDayEt?: string;
  sipVariant?: SipSipVariant;
};

type ArchiveFileV2 = { version: 2; entries: SipArchiveEntry[] };
type ArchiveFileV3 = { version: 3; entries: SipArchiveEntry[] };

function normalizeTickers(tickers: string[]): string[] {
  return [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function detailFromStocksInPlaySuccess(json: StocksInPlaySuccess): SipArchiveDayDetail {
  return {
    rows: (json.rows ?? []).slice(0, ARCHIVE_TICKER_SOFT_CAP),
    news: json.news ?? null,
    catalyst: json.catalyst ?? null,
    pythonConfigured: json.pythonConfigured,
    newsError: json.newsError ?? null,
    catalystError: json.catalystError ?? null,
    catalystSkipped: json.catalystSkipped,
  };
}

function detailFromDaySnap(snap: SipDaySnapshotV1): SipArchiveDayDetail {
  return {
    rows: snap.rows.slice(0, ARCHIVE_TICKER_SOFT_CAP),
    news: snap.news ?? null,
    catalyst: snap.catalyst ?? null,
    pythonConfigured: snap.pythonConfigured,
    newsError: snap.newsError ?? null,
    catalystError: snap.catalystError ?? null,
  };
}

function normalizeArchiveEntry(e: unknown): SipArchiveEntry | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (typeof o.uaeYmd !== "string" || !Array.isArray(o.tickers)) return null;
  const rawTickers = o.tickers as string[];
  const upper = rawTickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean);
  const tickers =
    o.sipVariant === "small-cap"
      ? normalizeTickers(upper).slice(0, SIP_SMALL_CAP_MAX_TICKERS)
      : upper.slice(0, ARCHIVE_TICKER_SOFT_CAP);
  let detail: SipArchiveDayDetail | null | undefined;
  if (o.detail && typeof o.detail === "object") {
    const d = o.detail as Record<string, unknown>;
    if (Array.isArray(d.rows)) {
      detail = {
        rows: (d.rows as GapperRow[]).slice(0, ARCHIVE_TICKER_SOFT_CAP),
        news: (d.news as Record<string, PythonNewsItem[]>) ?? null,
        catalyst: (d.catalyst as Record<string, SipCatalyst>) ?? null,
        pythonConfigured: Boolean(d.pythonConfigured),
        newsError: (d.newsError as string) ?? null,
        catalystError: (d.catalystError as string) ?? null,
        catalystSkipped: Boolean(d.catalystSkipped),
      };
    }
  }
  const archiveDayEt = typeof o.archiveDayEt === "string" ? o.archiveDayEt : undefined;
  const sipVariant =
    o.sipVariant === "mid-large" || o.sipVariant === "small-cap" ? (o.sipVariant as SipSipVariant) : undefined;
  return { uaeYmd: o.uaeYmd, tickers, detail: detail ?? null, archiveDayEt, sipVariant };
}

function sortArchiveEntries(entries: SipArchiveEntry[]): SipArchiveEntry[] {
  const variantRank = (e: SipArchiveEntry) =>
    e.sipVariant === "mid-large" ? 0 : e.sipVariant === "small-cap" ? 1 : 2;
  return [...entries].sort((a, b) => {
    const da = a.archiveDayEt ?? a.uaeYmd;
    const db = b.archiveDayEt ?? b.uaeYmd;
    const c = db.localeCompare(da);
    if (c !== 0) return c;
    return variantRank(a) - variantRank(b);
  });
}

export function loadSipArchiveEntries(): SipArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SIP_ARCHIVE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ArchiveFileV2 | ArchiveFileV3 | { version: 1; entries: unknown[] };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) return [];

    if (parsed.version === 3) {
      const entries = parsed.entries.map((e) => normalizeArchiveEntry(e)).filter(Boolean) as SipArchiveEntry[];
      return sortArchiveEntries(entries);
    }

    if (parsed.version === 2) {
      const entries = parsed.entries.map((e) => normalizeArchiveEntry(e)).filter(Boolean) as SipArchiveEntry[];
      const sorted = sortArchiveEntries(entries);
      try {
        saveSipArchiveEntries(sorted);
      } catch {
        /* ignore migrate */
      }
      return sorted;
    }

    if (parsed.version === 1) {
      const migrated = parsed.entries
        .filter((e): e is { uaeYmd: string; tickers: string[] } =>
          Boolean(e && typeof (e as { uaeYmd?: string }).uaeYmd === "string" && Array.isArray((e as { tickers?: unknown }).tickers))
        )
        .map((e) => ({
          uaeYmd: e.uaeYmd,
          tickers: normalizeTickers(e.tickers).slice(0, SIP_MAX_TICKERS),
          detail: null as SipArchiveDayDetail | null,
        }));
      try {
        localStorage.setItem(
          SIP_ARCHIVE_LS_KEY,
          JSON.stringify({ version: 3, entries: migrated } satisfies ArchiveFileV3)
        );
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("premarket-sip-archive-updated"));
        }
      } catch {
        /* ignore */
      }
      return sortArchiveEntries(migrated);
    }
    return [];
  } catch {
    return [];
  }
}

function saveSipArchiveEntries(entries: SipArchiveEntry[]): void {
  try {
    const file: ArchiveFileV3 = { version: 3, entries: entries.slice(0, MAX_ENTRIES) };
    localStorage.setItem(SIP_ARCHIVE_LS_KEY, JSON.stringify(file));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("premarket-sip-archive-updated"));
    }
  } catch {
    /* ignore */
  }
}

/** Eastern “yesterday” relative to now (archive window at 02:00 UAE pass). */
export function archiveTargetEtYmdBeforeNow(now = DateTime.now()): string {
  return now.setZone("America/New_York").minus({ days: 1 }).toFormat("yyyy-MM-dd");
}

export function formatSipArchiveRowDate(uaeYmd: string): string {
  const dt = DateTime.fromFormat(uaeYmd, "yyyy-MM-dd", { zone: "Asia/Dubai" });
  if (!dt.isValid) return uaeYmd;
  return dt.toFormat("dd LLL yyyy");
}

export function formatSipArchiveRowDateEt(ymdEt: string): string {
  const dt = DateTime.fromFormat(ymdEt, "yyyy-MM-dd", { zone: "America/New_York" });
  if (!dt.isValid) return ymdEt;
  return dt.toFormat("dd LLL yyyy");
}

/** Milliseconds until next 02:00:05 in Asia/Dubai. */
export function msUntilNext2amDubai(afterSeconds = 5): number {
  const dubai = DateTime.now().setZone("Asia/Dubai");
  let target = dubai.set({ hour: 2, minute: 0, second: afterSeconds, millisecond: 0 });
  if (dubai >= target) {
    target = target.plus({ days: 1 });
  }
  return Math.max(5_000, target.toMillis() - dubai.toMillis());
}

export function getSipArchiveRowKey(e: SipArchiveEntry): string {
  const day = e.archiveDayEt ?? e.uaeYmd;
  return `${day}-${e.sipVariant ?? "legacy"}`;
}

/** Collapsed-row summary with SIP variant prefix when present (v3). */
export function formatSipArchiveTickerSummary(entry: SipArchiveEntry): string {
  const t = entry.tickers.length ? entry.tickers.join(" - ") : "—";
  if (entry.sipVariant === "mid-large") return `SIP - Mid-Large Caps: ${t}`;
  if (entry.sipVariant === "small-cap") return `SIP - Small Caps: ${t}`;
  return t;
}

function makeEntryFromSnap(etYmd: string, variant: SipPersistVariant, snap: SipDaySnapshotV1): SipArchiveEntry {
  const tickers = snap.rows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean).slice(0, ARCHIVE_TICKER_SOFT_CAP);
  const sipVariant: SipSipVariant = variant === "mid-large" ? "mid-large" : "small-cap";
  return {
    uaeYmd: etYmd,
    archiveDayEt: etYmd,
    sipVariant,
    tickers,
    detail: detailFromDaySnap(snap),
  };
}

/**
 * At 02:00 Asia/Dubai, append up to two rows for **yesterday ET** if SIP day snapshots exist
 * and those variant rows are not already archived.
 */
export async function tryAppendSipArchiveAt2amDubai(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const targetEt = archiveTargetEtYmdBeforeNow();
  let entries = loadSipArchiveEntries();

  const hasMid = entries.some(
    (e) => (e.archiveDayEt ?? e.uaeYmd) === targetEt && e.sipVariant === "mid-large"
  );
  const hasSmall = entries.some(
    (e) => (e.archiveDayEt ?? e.uaeYmd) === targetEt && e.sipVariant === "small-cap"
  );
  if (hasMid && hasSmall) return false;

  const toAdd: SipArchiveEntry[] = [];
  if (!hasMid) {
    const snap = loadSipDaySnapshot(targetEt, "mid-large");
    if (snap?.rows?.length) toAdd.push(makeEntryFromSnap(targetEt, "mid-large", snap));
  }
  if (!hasSmall) {
    const snap = loadSipDaySnapshot(targetEt, "small-cap");
    if (snap?.rows?.length) toAdd.push(makeEntryFromSnap(targetEt, "small-cap", snap));
  }

  if (toAdd.length === 0) return false;

  const next = sortArchiveEntries([...toAdd, ...entries]);
  saveSipArchiveEntries(next);
  return true;
}

/** Optional: migrate v2 on disk to v3 when first loaded in loadSipArchiveEntries (v1 path). */
