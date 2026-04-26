import { DateTime } from "luxon";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";
import { gapperFilterStateToRequestBody, loadSipGapperFiltersFromStorage } from "@/components/premarket/gapper-filters-storage";
import { SIP_MAX_TICKERS } from "@/lib/premarket/sip-constants";

export const SIP_ARCHIVE_LS_KEY = "stockstalker-sip-archive-v1";
export const SIP_ARCHIVE_SNAPSHOT_LS_KEY = "stockstalker-sip-archive-snapshot-v1";

const MAX_ENTRIES = 120;

export type SipArchiveDayDetail = {
  rows: GapperRow[];
  news: Record<string, PythonNewsItem[]> | null;
  catalyst: Record<string, SipCatalyst> | null;
  pythonConfigured: boolean;
  newsError?: string | null;
  catalystError?: string | null;
  catalystSkipped?: boolean;
};

export type SipArchiveEntry = {
  /** UAE calendar date (yyyy-MM-dd) for the trading day that ended at the following Dubai midnight. */
  uaeYmd: string;
  tickers: string[];
  /** Full SIP snapshot when available (v2 archives and live snapshot). */
  detail?: SipArchiveDayDetail | null;
};

type ArchiveFileV1 = { version: 1; entries: { uaeYmd: string; tickers: string[] }[] };
type ArchiveFileV2 = { version: 2; entries: SipArchiveEntry[] };

type LiveSnapshotV2 = {
  version: 2;
  uaeYmd: string;
  tickers: string[];
  savedAtMs: number;
  detail: SipArchiveDayDetail;
};

/** Legacy live snapshot (tickers only). */
type LiveSnapshotV1 = {
  uaeYmd: string;
  tickers: string[];
  savedAtMs: number;
};

function normalizeTickers(tickers: string[]): string[] {
  return [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function detailFromStocksInPlaySuccess(json: StocksInPlaySuccess): SipArchiveDayDetail {
  return {
    rows: (json.rows ?? []).slice(0, SIP_MAX_TICKERS),
    news: json.news ?? null,
    catalyst: json.catalyst ?? null,
    pythonConfigured: json.pythonConfigured,
    newsError: json.newsError ?? null,
    catalystError: json.catalystError ?? null,
    catalystSkipped: json.catalystSkipped,
  };
}

/** Call whenever SIP API succeeds so midnight archive can prefer the last in-zone snapshot with full rows. */
export function recordSipSnapshotForArchive(json: StocksInPlaySuccess): void {
  if (typeof window === "undefined") return;
  const z = DateTime.now().setZone("Asia/Dubai");
  const capped: StocksInPlaySuccess = { ...json, rows: (json.rows ?? []).slice(0, SIP_MAX_TICKERS) };
  const detail = detailFromStocksInPlaySuccess(capped);
  const snap: LiveSnapshotV2 = {
    version: 2,
    uaeYmd: z.toFormat("yyyy-MM-dd"),
    tickers: normalizeTickers((capped.rows ?? []).map((r) => r.ticker)),
    savedAtMs: Date.now(),
    detail,
  };
  try {
    localStorage.setItem(SIP_ARCHIVE_SNAPSHOT_LS_KEY, JSON.stringify(snap));
  } catch {
    /* ignore quota */
  }
}

function normalizeArchiveEntry(e: unknown): SipArchiveEntry | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (typeof o.uaeYmd !== "string" || !Array.isArray(o.tickers)) return null;
  const tickers = normalizeTickers(o.tickers as string[]).slice(0, SIP_MAX_TICKERS);
  let detail: SipArchiveDayDetail | null | undefined;
  if (o.detail && typeof o.detail === "object") {
    const d = o.detail as Record<string, unknown>;
    if (Array.isArray(d.rows)) {
      detail = {
        rows: (d.rows as GapperRow[]).slice(0, SIP_MAX_TICKERS),
        news: (d.news as Record<string, PythonNewsItem[]>) ?? null,
        catalyst: (d.catalyst as Record<string, SipCatalyst>) ?? null,
        pythonConfigured: Boolean(d.pythonConfigured),
        newsError: (d.newsError as string) ?? null,
        catalystError: (d.catalystError as string) ?? null,
        catalystSkipped: Boolean(d.catalystSkipped),
      };
    }
  }
  return { uaeYmd: o.uaeYmd, tickers, detail: detail ?? null };
}

export function loadSipArchiveEntries(): SipArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SIP_ARCHIVE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ArchiveFileV1 | ArchiveFileV2;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) return [];

    if (parsed.version === 2) {
      return parsed.entries.map((e) => normalizeArchiveEntry(e)).filter(Boolean) as SipArchiveEntry[];
    }
    if (parsed.version === 1) {
      const migrated = parsed.entries
        .filter((e) => e && typeof e.uaeYmd === "string" && Array.isArray(e.tickers))
        .map((e) => ({
          uaeYmd: e.uaeYmd,
          tickers: normalizeTickers(e.tickers).slice(0, SIP_MAX_TICKERS),
          detail: null as SipArchiveDayDetail | null,
        }));
      try {
        localStorage.setItem(SIP_ARCHIVE_LS_KEY, JSON.stringify({ version: 2, entries: migrated } satisfies ArchiveFileV2));
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("premarket-sip-archive-updated"));
        }
      } catch {
        /* ignore */
      }
      return migrated;
    }
    return [];
  } catch {
    return [];
  }
}

function saveSipArchiveEntries(entries: SipArchiveEntry[]): void {
  try {
    const file: ArchiveFileV2 = { version: 2, entries: entries.slice(0, MAX_ENTRIES) };
    localStorage.setItem(SIP_ARCHIVE_LS_KEY, JSON.stringify(file));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("premarket-sip-archive-updated"));
    }
  } catch {
    /* ignore */
  }
}

function readSnapshot(): LiveSnapshotV2 | LiveSnapshotV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SIP_ARCHIVE_SNAPSHOT_LS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.version === 2 && typeof j.uaeYmd === "string" && j.detail && typeof j.detail === "object") {
      const normalized = normalizeArchiveEntry({ uaeYmd: j.uaeYmd, tickers: j.tickers, detail: j.detail });
      if (!normalized?.detail) return null;
      return {
        version: 2,
        uaeYmd: normalized.uaeYmd,
        tickers: normalized.tickers,
        savedAtMs: Number(j.savedAtMs) || 0,
        detail: normalized.detail,
      };
    }
    if (typeof j.uaeYmd === "string" && Array.isArray(j.tickers)) {
      return { uaeYmd: j.uaeYmd, tickers: normalizeTickers(j.tickers as string[]), savedAtMs: Number(j.savedAtMs) || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFullSip(): Promise<StocksInPlaySuccess | null> {
  const body = gapperFilterStateToRequestBody(loadSipGapperFiltersFromStorage());
  const res = await fetch("/api/premarket/stocks-in-play", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as StocksInPlaySuccess | { ok?: false };
  if (!res.ok || !json.ok || !("rows" in json)) return null;
  const ok = json as StocksInPlaySuccess;
  return { ...ok, rows: (ok.rows ?? []).slice(0, SIP_MAX_TICKERS) };
}

/**
 * Completed UAE calendar day to archive (the day that ended at the most recent Dubai midnight).
 * After 2026-04-27 00:00 Dubai, returns 2026-04-26.
 */
export function completedUaeDayToArchiveYmd(now: DateTime = DateTime.now().setZone("Asia/Dubai")): string {
  return now.startOf("day").minus({ days: 1 }).toFormat("yyyy-MM-dd");
}

export function formatSipArchiveRowDate(uaeYmd: string): string {
  const dt = DateTime.fromFormat(uaeYmd, "yyyy-MM-dd", { zone: "Asia/Dubai" });
  if (!dt.isValid) return uaeYmd;
  return dt.toFormat("dd LLL yyyy");
}

export function msUntilNextDubaiMidnight(afterSeconds = 10): number {
  const dubai = DateTime.now().setZone("Asia/Dubai");
  const nextMidnight = dubai.plus({ days: 1 }).startOf("day").set({ second: afterSeconds, millisecond: 0 });
  return Math.max(10_000, nextMidnight.toMillis() - dubai.toMillis());
}

/**
 * If the archive does not yet contain the last completed UAE day, append it (full snapshot preferred, else live fetch).
 * Returns true when the archive file changed.
 */
export async function tryAppendSipArchiveForCompletedUaeDay(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const now = DateTime.now().setZone("Asia/Dubai");
  const targetYmd = completedUaeDayToArchiveYmd(now);

  const entries = loadSipArchiveEntries();
  if (entries.some((e) => e.uaeYmd === targetYmd)) return false;

  const snapshot = readSnapshot();
  let entry: SipArchiveEntry;

  if (snapshot && snapshot.uaeYmd === targetYmd && "version" in snapshot && snapshot.version === 2 && snapshot.detail) {
    entry = {
      uaeYmd: targetYmd,
      tickers: snapshot.tickers,
      detail: snapshot.detail,
    };
  } else if (snapshot && snapshot.uaeYmd === targetYmd && Array.isArray(snapshot.tickers)) {
    const full = await fetchFullSip();
    if (full) {
      entry = {
        uaeYmd: targetYmd,
        tickers: normalizeTickers((full.rows ?? []).map((r) => r.ticker)),
        detail: detailFromStocksInPlaySuccess(full),
      };
    } else {
      entry = { uaeYmd: targetYmd, tickers: snapshot.tickers, detail: null };
    }
  } else {
    const full = await fetchFullSip();
    if (full) {
      entry = {
        uaeYmd: targetYmd,
        tickers: normalizeTickers((full.rows ?? []).map((r) => r.ticker)),
        detail: detailFromStocksInPlaySuccess(full),
      };
    } else {
      entry = { uaeYmd: targetYmd, tickers: [], detail: null };
    }
  }

  const next: SipArchiveEntry[] = [entry, ...entries.filter((e) => e.uaeYmd !== targetYmd)].sort((a, b) =>
    b.uaeYmd.localeCompare(a.uaeYmd)
  );
  saveSipArchiveEntries(next);
  return true;
}
