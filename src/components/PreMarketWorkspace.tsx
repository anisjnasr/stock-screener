"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { PremarketMoverRow } from "@/lib/premarket-types";
import type { ChartTimeframe } from "@/components/StockChart";
import type { StockFlag } from "@/lib/watchlist-storage";
import StockChart from "@/components/StockChart";
import type { Candle } from "@/hooks/useCandleCache";
import {
  ACTIVE_PREMARKET_SESSION_KEY,
  formatLedgerHeading,
  loadLedger,
  mergeLedgerDay,
  premarketSessionEtDateKey,
  saveLedger,
  type PremarketLedger,
} from "@/lib/premarket-ledger";
import {
  loadPremarketGappersDisplay,
  PREMARKET_GAPPERS_DISPLAY_DEFAULTS,
  savePremarketGappersDisplay,
} from "@/lib/premarket-gappers-display-storage";
import {
  loadPremarketThresholds,
  PREMARKET_THRESHOLDS_DEFAULTS,
  savePremarketThresholds,
} from "@/lib/premarket-thresholds-storage";
import {
  catalystEntryOrStringToEntry,
  catalystSummaryText,
  categoryBadgeLabel,
  migrateCatalystStorageJson,
  normalizeCatalystFromApi,
  type CatalystCategory,
  type GuidanceTone,
  type PremarketCatalystEntry,
} from "@/lib/premarket-catalyst-types";

const SIP_COL_WIDTHS_KEY = "premarket-sip-col-widths-v2";
const GAP_COL_WIDTHS_KEY = "premarket-gappers-col-widths-v4";

/** Wider mins so headers wrap inside cells instead of overlapping adjacent columns. */
const SIP_COL_MINS = [40, 60, 120, 58, 58, 70, 80, 96, 64, 76] as const;
const SIP_COL_DEFAULTS = [48, 76, 240, 68, 68, 78, 92, 108, 76, 96] as const;

/** Top Movers table: Ticker, Company, Price, Gap %, PM Vol, Vol %, MCap */
const GAP_COL_MINS = [56, 120, 54, 72, 80, 64, 88] as const;
const GAP_COL_DEFAULTS = [72, 200, 62, 80, 92, 72, 96] as const;

function loadColWidths(key: string, mins: readonly number[], defaults: readonly number[]): number[] {
  if (typeof window === "undefined") return [...defaults];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...defaults];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p) || p.length !== defaults.length) return [...defaults];
    return defaults.map((d, i) => {
      const n = Number(p[i]);
      return Math.max(mins[i] ?? 40, Number.isFinite(n) ? n : d);
    });
  } catch {
    return [...defaults];
  }
}

function saveColWidths(key: string, widths: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    /* ignore */
  }
}

const thBorderStyle = { borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" } as const;

function ResizableTh({
  align,
  children,
  colIdx,
  onResizePointerDown,
  showHandle,
}: {
  align: "left" | "right" | "center";
  children: React.ReactNode;
  colIdx: number;
  onResizePointerDown: (e: ReactPointerEvent, colIdx: number) => void;
  showHandle: boolean;
}) {
  const ac = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={`relative ${ac} py-2 pl-1.5 align-bottom text-ws-body font-semibold border-b box-border ${
        showHandle ? "pr-2.5" : "pr-1.5"
      }`}
      style={{ ...thBorderStyle, overflow: "hidden" }}
    >
      <span className={`block w-full min-w-0 break-words leading-snug ${align === "center" ? "text-center" : ""}`}>
        {children}
      </span>
      {showHandle ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize touch-none select-none group"
          style={{ zIndex: 1 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onResizePointerDown(e, colIdx);
          }}
        >
          <span className="absolute inset-y-0 right-1 w-px bg-[var(--ws-border)] group-hover:bg-[var(--ws-cyan)]" />
        </div>
      ) : null}
    </th>
  );
}

function digitsOnlyIntString(s: string): string {
  return s.replace(/\D/g, "");
}

function formatThousandsDisplay(raw: string): string {
  const d = digitsOnlyIntString(raw);
  if (!d) return "";
  const n = Number(d);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US");
}

function sipPlaceholderRow(ticker: string): PremarketMoverRow {
  return {
    ticker,
    name: "—",
    prevClose: NaN,
    lastPrice: NaN,
    gapPct: Number.NEGATIVE_INFINITY,
    pmVolume: NaN,
    avgVolume1m: null,
    marketCap: null,
    volRatioPct: null,
  };
}

/** Stocks in Play table: show at most this many rows until redesign. */
const SIP_TABLE_MAX_ROWS = 10;

const SIP_STORAGE_PREFIX = "premarket-sip-v2:";
const SIP_ROWS_STORAGE_PREFIX = "premarket-sip-rows-v2:";

function sipRowsStorageKey(): string {
  return `${SIP_ROWS_STORAGE_PREFIX}${premarketSessionEtDateKey()}`;
}

const SIP_CATALYST_V2_PREFIX = "premarket-sip-catalyst-v2:";
const SIP_CATALYST_V3_PREFIX = "premarket-sip-catalyst-v3:";

function sipCatalystStorageKey(ymd = premarketSessionEtDateKey()): string {
  return `${SIP_CATALYST_V3_PREFIX}${ymd}`;
}

function removeCatalystKeysForSession(ymd: string) {
  try {
    localStorage.removeItem(`${SIP_CATALYST_V3_PREFIX}${ymd}`);
    localStorage.removeItem(`${SIP_CATALYST_V2_PREFIX}${ymd}`);
  } catch {
    /* ignore */
  }
}

function loadMergedCatalystFromDisk(ymd: string): Record<string, PremarketCatalystEntry> {
  try {
    const raw3 = localStorage.getItem(`${SIP_CATALYST_V3_PREFIX}${ymd}`);
    const raw2 = localStorage.getItem(`${SIP_CATALYST_V2_PREFIX}${ymd}`);
    let merged: Record<string, PremarketCatalystEntry> = {};
    if (raw3) merged = { ...merged, ...migrateCatalystStorageJson(JSON.parse(raw3) as unknown) };
    if (raw2) merged = { ...merged, ...migrateCatalystStorageJson(JSON.parse(raw2) as unknown) };
    return merged;
  } catch {
    return {};
  }
}

function coerceSnapshot(v: unknown): PremarketMoverRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ticker = String(o.ticker ?? "").toUpperCase().trim();
  if (!ticker) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : NaN);
  const prevClose = num(o.prevClose);
  const lastPrice = num(o.lastPrice);
  const gapPct = num(o.gapPct);
  const pmVolume = num(o.pmVolume);
  if (!Number.isFinite(lastPrice) && !Number.isFinite(gapPct) && !Number.isFinite(pmVolume)) return null;
  return {
    ticker,
    name: typeof o.name === "string" && o.name.trim() ? o.name : ticker,
    prevClose,
    lastPrice,
    gapPct: Number.isFinite(gapPct) ? gapPct : Number.NEGATIVE_INFINITY,
    pmVolume,
    avgVolume1m:
      typeof o.avgVolume1m === "number" && Number.isFinite(o.avgVolume1m) ? o.avgVolume1m : null,
    marketCap: typeof o.marketCap === "number" && Number.isFinite(o.marketCap) ? o.marketCap : null,
    volRatioPct:
      typeof o.volRatioPct === "number" && Number.isFinite(o.volRatioPct) ? o.volRatioPct : null,
  };
}

function loadSipRowSnapshots(): Record<string, PremarketMoverRow> {
  try {
    const raw = localStorage.getItem(sipRowsStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, PremarketMoverRow> = {};
    for (const v of Object.values(parsed)) {
      const row = coerceSnapshot(v);
      if (row) out[row.ticker] = row;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSipRowSnapshots(rows: Record<string, PremarketMoverRow>) {
  try {
    localStorage.setItem(sipRowsStorageKey(), JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtVol(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtMcap(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmtVol(n);
}

function catalystBadgeChrome(
  category: CatalystCategory,
  guidanceTone: GuidanceTone | null
): { background: string; color: string; border: string } {
  if (category === "GUIDANCE" && guidanceTone === "raised") {
    return {
      background: "rgba(34,197,94,0.18)",
      color: "rgb(134,239,172)",
      border: "1px solid rgba(34,197,94,0.35)",
    };
  }
  if (category === "GUIDANCE" && guidanceTone === "lowered") {
    return {
      background: "rgba(239,68,68,0.15)",
      color: "rgb(252,165,165)",
      border: "1px solid rgba(239,68,68,0.35)",
    };
  }
  if (category === "GUIDANCE") {
    return {
      background: "rgba(148,163,184,0.15)",
      color: "rgb(203,213,225)",
      border: "1px solid rgba(148,163,184,0.3)",
    };
  }
  const map: Partial<Record<CatalystCategory, { background: string; color: string; border: string }>> = {
    EARNINGS: {
      background: "rgba(34,197,94,0.12)",
      color: "rgb(74,222,128)",
      border: "1px solid rgba(34,197,94,0.28)",
    },
    CONTRACT: {
      background: "rgba(59,130,246,0.15)",
      color: "rgb(147,197,253)",
      border: "1px solid rgba(59,130,246,0.35)",
    },
    CLINICAL: {
      background: "rgba(168,85,247,0.18)",
      color: "rgb(233,213,255)",
      border: "1px solid rgba(168,85,247,0.35)",
    },
    M_AND_A: {
      background: "rgba(139,92,246,0.18)",
      color: "rgb(196,181,253)",
      border: "1px solid rgba(139,92,246,0.35)",
    },
    PARTNERSHIP: {
      background: "rgba(45,212,191,0.14)",
      color: "rgb(153,246,228)",
      border: "1px solid rgba(45,212,191,0.32)",
    },
    UPGRADE: {
      background: "rgba(245,158,11,0.18)",
      color: "rgb(253,230,138)",
      border: "1px solid rgba(245,158,11,0.4)",
    },
    MANAGEMENT: {
      background: "rgba(148,163,184,0.12)",
      color: "rgb(203,213,225)",
      border: "1px solid rgba(148,163,184,0.28)",
    },
    UNKNOWN: {
      background: "rgba(100,116,139,0.12)",
      color: "rgb(148,163,184)",
      border: "1px solid rgba(100,116,139,0.25)",
    },
  };
  return map[category] ?? map.UNKNOWN!;
}

function renderCatalystSummary(summary: string | undefined, loading: boolean): ReactNode {
  if (loading) {
    return <span style={{ color: "var(--ws-text-vdim)" }}>…</span>;
  }
  const t = (summary ?? "").trim();
  if (!t || t === "No news") {
    return <span style={{ color: "var(--ws-text-vdim)" }}>No news</span>;
  }
  if (t === "Catalyst unavailable") {
    return <span style={{ color: "var(--ws-text-dim)" }}>Catalyst unavailable</span>;
  }
  const parts = t.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <span className="text-ws-body leading-snug">
      {parts.map((part, i) => {
        const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m) {
          const href = m[2];
          if (!/^https?:\/\//i.test(href)) {
            return <span key={i}>{part}</span>;
          }
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline break-all"
              style={{ color: "var(--ws-blue)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {m[1]}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function SipGainerCard({
  row,
  entry,
  loading,
  selected,
  onSelect,
}: {
  row: PremarketMoverRow;
  entry: PremarketCatalystEntry | undefined;
  loading: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const gapUp = row.gapPct >= 0;
  const e = entry ?? normalizeCatalystFromApi({ summary: "No news" });
  const badgeLabel = categoryBadgeLabel(e.category, e.guidanceTone);
  const chrome = catalystBadgeChrome(e.category, e.guidanceTone);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-xl border flex overflow-hidden transition-colors ws-focus-ring"
      style={{
        borderColor: "var(--ws-border)",
        background: "var(--ws-bg)",
        boxShadow: selected ? "0 0 0 1px rgba(0,229,204,0.35)" : "none",
      }}
    >
      <div
        className="shrink-0 flex flex-col items-center justify-center px-3 py-3 w-[5.5rem] border-r"
        style={{
          borderColor: "var(--ws-border)",
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <span
          className="w-1 self-stretch rounded-full mb-2"
          style={{ background: gapUp ? "var(--ws-green)" : "var(--ws-red)" }}
          aria-hidden
        />
        <span
          className="text-lg font-bold tabular-nums leading-tight"
          style={{ color: gapUp ? "var(--ws-green)" : "var(--ws-red)" }}
        >
          {fmtPct(row.gapPct)}
        </span>
        <span className="text-ws-caption tabular-nums mt-1" style={{ color: "var(--ws-text)" }}>
          {fmtPrice(row.lastPrice)}
        </span>
      </div>
      <div className="flex-1 min-w-0 py-3 pr-3 pl-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0">
            <span className="font-mono text-ws-title font-semibold" style={{ color: "var(--ws-cyan)" }}>
              {row.ticker}
            </span>
            <span className="text-ws-caption truncate max-w-[14rem]" style={{ color: "var(--ws-text-dim)" }} title={row.name}>
              {row.name}
            </span>
          </div>
          <span
            className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
            style={loading ? catalystBadgeChrome("UNKNOWN", null) : chrome}
          >
            {loading ? "…" : badgeLabel === "—" ? "NEWS" : badgeLabel}
          </span>
        </div>
        <div className="text-ws-body leading-relaxed min-h-[3.5rem]" style={{ color: "var(--ws-text-dim)" }}>
          {loading ? (
            <span style={{ color: "var(--ws-text-vdim)" }}>Loading catalyst…</span>
          ) : (
            renderCatalystSummary(catalystSummaryText(e), false)
          )}
        </div>
      </div>
    </button>
  );
}

type PreMarketWorkspaceProps = {
  selectedSymbol: string;
  onSymbolSelect: (sym: string) => void;
  candles: Candle[] | null;
  chartLoading: boolean;
  onChartRetry: () => void;
  chartTimeframe: ChartTimeframe;
  onChartTimeframeChange: (tf: ChartTimeframe) => void;
  stockFlag: StockFlag | null;
  onFlagChange: (f: StockFlag | null) => void;
  watchlistPickerLists: Array<{ id: string; name: string; hasSymbol: boolean }>;
  onWatchlistMembershipSave: (changes: { id: string; add: boolean }[]) => void;
};

export default function PreMarketWorkspace({
  selectedSymbol,
  onSymbolSelect,
  candles,
  chartLoading,
  onChartRetry,
  chartTimeframe,
  onChartTimeframeChange,
  stockFlag,
  onFlagChange,
  watchlistPickerLists,
  onWatchlistMembershipSave,
}: PreMarketWorkspaceProps) {
  const [minPrice, setMinPrice] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minPrice : PREMARKET_THRESHOLDS_DEFAULTS.minPrice
  );
  const [minGapPct, setMinGapPct] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minGapPct : PREMARKET_THRESHOLDS_DEFAULTS.minGapPct
  );
  const [minPmVolume, setMinPmVolume] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minPmVolume : PREMARKET_THRESHOLDS_DEFAULTS.minPmVolume
  );
  const [minAvgVolume, setMinAvgVolume] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minAvgVolume : PREMARKET_THRESHOLDS_DEFAULTS.minAvgVolume
  );
  const [minMarketCap, setMinMarketCap] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minMarketCap : PREMARKET_THRESHOLDS_DEFAULTS.minMarketCap
  );

  const [moversMaxRows, setMoversMaxRows] = useState(() =>
    typeof window !== "undefined"
      ? loadPremarketGappersDisplay().maxRows
      : PREMARKET_GAPPERS_DISPLAY_DEFAULTS.maxRows
  );

  const [movers, setMovers] = useState<PremarketMoverRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  /** When SIP is empty but we have movers: explain that thresholds filtered everyone out. */
  const [sipEmptyHint, setSipEmptyHint] = useState<string | null>(null);

  const [ledger, setLedger] = useState<PremarketLedger>(() =>
    typeof window === "undefined" ? {} : loadLedger()
  );
  const [ledgerExpandedYmd, setLedgerExpandedYmd] = useState<string | null>(null);

  const [lastByTicker, setLastByTicker] = useState<Record<string, PremarketMoverRow>>({});
  const [catalystMap, setCatalystMap] = useState<Record<string, PremarketCatalystEntry>>({});
  const [catalystLoading, setCatalystLoading] = useState<Record<string, boolean>>({});
  const catalystMapRef = useRef<Record<string, PremarketCatalystEntry>>({});
  catalystMapRef.current = catalystMap;

  const sessionEtDateRef = useRef(premarketSessionEtDateKey());
  const sipStateRef = useRef({ movers, lastByTicker, catalystMap });
  sipStateRef.current = { movers, lastByTicker, catalystMap };
  const skipNextThresholdSaveRef = useRef(true);
  const skipNextMoversDisplaySaveRef = useRef(true);

  const [sipColWidths, setSipColWidths] = useState(() =>
    loadColWidths(SIP_COL_WIDTHS_KEY, SIP_COL_MINS, SIP_COL_DEFAULTS)
  );
  const [gapColWidths, setGapColWidths] = useState(() =>
    loadColWidths(GAP_COL_WIDTHS_KEY, GAP_COL_MINS, GAP_COL_DEFAULTS)
  );
  const sipWidthsRef = useRef(sipColWidths);
  sipWidthsRef.current = sipColWidths;
  const gapWidthsRef = useRef(gapColWidths);
  gapWidthsRef.current = gapColWidths;

  useEffect(() => {
    saveColWidths(SIP_COL_WIDTHS_KEY, sipColWidths);
  }, [sipColWidths]);
  useEffect(() => {
    saveColWidths(GAP_COL_WIDTHS_KEY, gapColWidths);
  }, [gapColWidths]);

  const onSipColResizePointerDown = useCallback((e: ReactPointerEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = sipWidthsRef.current[idx] ?? SIP_COL_DEFAULTS[idx]!;
    const minW = SIP_COL_MINS[idx] ?? 40;
    const move = (ev: PointerEvent) => {
      const dw = ev.clientX - startX;
      setSipColWidths((p) => {
        const n = [...p];
        n[idx] = Math.max(minW, startW + dw);
        return n;
      });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }, []);

  const onGapColResizePointerDown = useCallback((e: ReactPointerEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = gapWidthsRef.current[idx] ?? GAP_COL_DEFAULTS[idx]!;
    const minW = GAP_COL_MINS[idx] ?? 40;
    const move = (ev: PointerEvent) => {
      const dw = ev.clientX - startX;
      setGapColWidths((p) => {
        const n = [...p];
        n[idx] = Math.max(minW, startW + dw);
        return n;
      });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }, []);

  /** Archive completed premarket session (rolls 04:00 ET) into ledger; clear working keys; advance active session date. */
  useEffect(() => {
    try {
      const today = premarketSessionEtDateKey();
      const active = localStorage.getItem(ACTIVE_PREMARKET_SESSION_KEY);
      if (active && active !== today) {
        const rawT = localStorage.getItem(`${SIP_STORAGE_PREFIX}${active}`);
        const rawR = localStorage.getItem(`${SIP_ROWS_STORAGE_PREFIX}${active}`);
        if (rawT) {
          const tickers = JSON.parse(rawT) as unknown;
          if (Array.isArray(tickers) && tickers.length > 0) {
            const rows: Record<string, PremarketMoverRow> = {};
            if (rawR) {
              const parsed = JSON.parse(rawR) as Record<string, unknown>;
              for (const v of Object.values(parsed)) {
                const row = coerceSnapshot(v);
                if (row) rows[row.ticker] = row;
              }
            }
            const catMerged = loadMergedCatalystFromDisk(active);
            const catalyst: Record<string, PremarketCatalystEntry> | undefined =
              Object.keys(catMerged).length > 0 ? catMerged : undefined;
            const nextLedger = mergeLedgerDay(loadLedger(), active, {
              tickers: tickers.map((t) => String(t).toUpperCase()).filter(Boolean),
              rows,
              catalyst,
            });
            saveLedger(nextLedger);
          }
        }
        localStorage.removeItem(`${SIP_STORAGE_PREFIX}${active}`);
        localStorage.removeItem(`${SIP_ROWS_STORAGE_PREFIX}${active}`);
        removeCatalystKeysForSession(active);
      }
      localStorage.setItem(ACTIVE_PREMARKET_SESSION_KEY, today);
      sessionEtDateRef.current = today;
      setLedger(loadLedger());
    } catch {
      /* ignore */
    }

    try {
      const snaps = loadSipRowSnapshots();
      if (Object.keys(snaps).length > 0) setLastByTicker(snaps);
      const mergedCat = loadMergedCatalystFromDisk(premarketSessionEtDateKey());
      if (Object.keys(mergedCat).length > 0) setCatalystMap(mergedCat);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onProfile = () => {
      const t = loadPremarketThresholds();
      setMinPrice(t.minPrice);
      setMinGapPct(t.minGapPct);
      setMinPmVolume(t.minPmVolume);
      setMinAvgVolume(t.minAvgVolume);
      setMinMarketCap(t.minMarketCap);
    };
    window.addEventListener("profile-changed", onProfile);
    return () => window.removeEventListener("profile-changed", onProfile);
  }, []);

  useEffect(() => {
    if (skipNextThresholdSaveRef.current) {
      skipNextThresholdSaveRef.current = false;
      return;
    }
    savePremarketThresholds({ minPrice, minGapPct, minPmVolume, minAvgVolume, minMarketCap });
  }, [minPrice, minGapPct, minPmVolume, minAvgVolume, minMarketCap]);

  useEffect(() => {
    if (skipNextMoversDisplaySaveRef.current) {
      skipNextMoversDisplaySaveRef.current = false;
      return;
    }
    savePremarketGappersDisplay({ maxRows: moversMaxRows });
  }, [moversMaxRows]);

  useEffect(() => {
    try {
      if (Object.keys(catalystMap).length === 0) return;
      localStorage.setItem(sipCatalystStorageKey(), JSON.stringify(catalystMap));
    } catch {
      /* ignore */
    }
  }, [catalystMap]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const today = premarketSessionEtDateKey();
      if (today === sessionEtDateRef.current) return;
      const prev = sessionEtDateRef.current;
      sessionEtDateRef.current = today;
      const { movers: mv, lastByTicker: lb, catalystMap: cm } = sipStateRef.current;
      const sorted = [...mv].sort((a, b) => b.gapPct - a.gapPct);
      const top10 = sorted.slice(0, SIP_TABLE_MAX_ROWS);
      if (top10.length > 0) {
        const tickers = top10.map((r) => r.ticker);
        const rows: Record<string, PremarketMoverRow> = {};
        for (const r of top10) {
          rows[r.ticker] = lb[r.ticker] ?? r;
        }
        const nextLedger = mergeLedgerDay(loadLedger(), prev, {
          tickers,
          rows,
          catalyst: { ...cm },
        });
        saveLedger(nextLedger);
      }
      localStorage.setItem(ACTIVE_PREMARKET_SESSION_KEY, today);
      localStorage.removeItem(`${SIP_STORAGE_PREFIX}${prev}`);
      localStorage.removeItem(`${SIP_ROWS_STORAGE_PREFIX}${prev}`);
      removeCatalystKeysForSession(prev);
      setLastByTicker({});
      setCatalystMap({});
      setLedger(loadLedger());
      setLedgerExpandedYmd(null);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const mp = Number(minPrice);
    const mg = Number(minGapPct);
    const mv = Number(minPmVolume);
    const ma = Number(minAvgVolume);
    const mc = Number(minMarketCap);
    if (![mp, mg, mv, ma, mc].every((n) => Number.isFinite(n) && n >= 0)) {
      setError("Invalid filter values");
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      direction: "gainers",
      minPrice: String(mp),
      minGapPct: String(mg),
      minPmVolume: String(mv),
      minAvgVolume: String(ma),
      minMarketCap: String(mc),
    });
    try {
      const res = await fetch(`/api/premarket/movers?${qs}`, { cache: "no-store" });
      const data = (await res.json()) as {
        movers?: PremarketMoverRow[];
        eligibleNow?: PremarketMoverRow[];
        error?: string;
        fetchedAt?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        setMovers([]);
        setSipEmptyHint(null);
        return;
      }
      const list = data.movers ?? [];
      setSipEmptyHint(list.length === 0 ? "No movers match the current filters — adjust thresholds and Refresh." : null);
      setMovers(list);
      setFetchedAt(data.fetchedAt ?? null);
      setLastByTicker((prev) => {
        const next = { ...prev };
        for (const r of list) next[r.ticker] = r;
        saveSipRowSnapshots(next);
        return next;
      });
    } catch {
      setError("Network error");
      setMovers([]);
      setSipEmptyHint(null);
    } finally {
      setLoading(false);
    }
  }, [minPrice, minGapPct, minPmVolume, minAvgVolume, minMarketCap]);

  useEffect(() => {
    void refresh();
    // Initial load only; filters apply on Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  const moversSortedByGap = useMemo(
    () => [...movers].sort((a, b) => b.gapPct - a.gapPct),
    [movers]
  );

  const sipRowsDisplayed = useMemo(
    () => moversSortedByGap.slice(0, SIP_TABLE_MAX_ROWS),
    [moversSortedByGap]
  );

  const topMoverRows = useMemo(() => {
    const maxR = Number(moversMaxRows);
    const cap = Number.isFinite(maxR) && maxR >= 1 ? Math.min(500, Math.floor(maxR)) : 50;
    return moversSortedByGap.slice(0, cap);
  }, [moversSortedByGap, moversMaxRows]);

  const sipKey = useMemo(
    () =>
      [...new Set(sipRowsDisplayed.map((r) => r.ticker))]
        .sort()
        .join(","),
    [sipRowsDisplayed]
  );

  useEffect(() => {
    const tickers = sipKey.length > 0 ? sipKey.split(",") : [];
    const missing = tickers.filter((t) => catalystMapRef.current[t] == null);
    if (missing.length === 0) return;
    let alive = true;
    const id = window.setTimeout(() => {
      setCatalystLoading((prev) => {
        const next = { ...prev };
        for (const m of missing) next[m] = true;
        return next;
      });
      void (async () => {
        try {
          const res = await fetch("/api/premarket/catalyst", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols: missing }),
          });
          const data = (await res.json()) as {
            results?: Record<string, { summary?: string; category?: unknown; guidanceTone?: unknown }>;
          };
          if (!alive) return;
          const r = data.results ?? {};
          setCatalystMap((prev) => {
            const next = { ...prev };
            for (const m of missing) {
              const row = r[m];
              next[m] = row ? normalizeCatalystFromApi(row) : normalizeCatalystFromApi({ summary: "No news" });
            }
            return next;
          });
        } catch {
          if (alive) {
            setCatalystMap((prev) => {
              const next = { ...prev };
              for (const m of missing) next[m] = normalizeCatalystFromApi({ summary: "No news" });
              return next;
            });
          }
        } finally {
          setCatalystLoading((prev) => {
            const next = { ...prev };
            for (const m of missing) delete next[m];
            return next;
          });
        }
      })();
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [sipKey]);

  const renderRow = (
    row: PremarketMoverRow,
    opts: {
      rank?: number;
      showCatalyst?: boolean;
      catalystMapOverride?: Record<string, string | PremarketCatalystEntry>;
      skipCatalystLoading?: boolean;
      rowKey?: string;
    }
  ) => {
    const rawCat =
      opts.catalystMapOverride != null ? opts.catalystMapOverride[row.ticker] : catalystMap[row.ticker];
    const catText = catalystSummaryText(
      catalystEntryOrStringToEntry(rawCat as PremarketCatalystEntry | string | undefined)
    );
    const catLoading = opts.skipCatalystLoading ? false : Boolean(catalystLoading[row.ticker]);
    const isSel =
      Boolean(selectedSymbol) && row.ticker.toUpperCase() === selectedSymbol.toUpperCase();
    return (
      <tr
        key={opts.rowKey ?? row.ticker}
        className="border-b cursor-pointer ws-row-hover ws-focus-ring"
        style={{
          borderColor: "var(--ws-border)",
          background: isSel ? "rgba(0,229,204,0.15)" : undefined,
        }}
        onClick={() => onSymbolSelect(row.ticker)}
      >
        {opts.rank != null && (
          <td
            className="py-1.5 px-1 text-center tabular-nums text-ws-body"
            style={{ color: "var(--ws-text-dim)" }}
            align="center"
          >
            {opts.rank}
          </td>
        )}
        <td
          className="py-1.5 px-1.5 font-mono text-ws-body font-semibold whitespace-nowrap"
          style={{ color: "var(--ws-cyan)" }}
        >
          {row.ticker}
        </td>
        <td className="py-1.5 px-1.5 text-ws-body min-w-0 truncate" style={{ color: "var(--ws-text)" }} title={row.name}>
          {row.name}
        </td>
        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
          {fmtPrice(row.prevClose)}
        </td>
        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text)" }}>
          {fmtPrice(row.lastPrice)}
        </td>
        <td
          className="py-1.5 px-1.5 text-right tabular-nums text-ws-body font-medium whitespace-nowrap"
          style={{ color: row.gapPct >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}
        >
          {fmtPct(row.gapPct)}
        </td>
        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text)" }}>
          {fmtVol(row.pmVolume)}
        </td>
        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
          {row.avgVolume1m != null ? fmtVol(row.avgVolume1m) : "—"}
        </td>
        <td
          className={`py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap ${
            row.volRatioPct != null && row.volRatioPct > 20 ? "font-medium" : ""
          }`}
          style={{
            color:
              row.volRatioPct != null && row.volRatioPct > 20
                ? "var(--ws-green)"
                : "var(--ws-text-dim)",
          }}
        >
          {row.volRatioPct != null ? fmtPct(row.volRatioPct) : "—"}
        </td>
        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
          {fmtMcap(row.marketCap)}
        </td>
        {opts.showCatalyst && (
          <td
            className="py-1.5 px-1.5 align-top min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            {renderCatalystSummary(catText, catLoading)}
          </td>
        )}
      </tr>
    );
  };

  const ledgerDatesDesc = useMemo(() => {
    const today = premarketSessionEtDateKey();
    return Object.keys(ledger)
      .filter((d) => d < today)
      .sort()
      .reverse();
  }, [ledger]);

  const ledgerExpandedRows = useMemo(() => {
    if (!ledgerExpandedYmd) return [];
    const day = ledger[ledgerExpandedYmd];
    if (!day) return [];
    return [...day.tickers]
      .map((t) => day.rows[t] ?? sipPlaceholderRow(t))
      .sort((a, b) => b.gapPct - a.gapPct);
  }, [ledger, ledgerExpandedYmd]);

  const filterInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { narrow?: boolean; thousands?: boolean }
  ) => {
    const display = opts?.thousands ? formatThousandsDisplay(value) : value;
    return (
      <label className="flex flex-col gap-0.5 min-w-0">
        <span className="text-ws-caption whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
          {label}
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={(e) => {
            if (opts?.thousands) onChange(digitsOnlyIntString(e.target.value));
            else onChange(e.target.value);
          }}
          className={`rounded px-2 py-1 text-ws-label tabular-nums ws-focus-ring ${
            opts?.thousands ? "w-[9.5rem] min-w-[7rem]" : opts?.narrow ? "w-[88px]" : "w-[120px]"
          }`}
          style={{
            background: "var(--ws-bg)",
            border: "1px solid var(--ws-border)",
            color: "var(--ws-text)",
          }}
        />
      </label>
    );
  };

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      {error && (
        <div className="shrink-0 px-3 py-1 text-ws-caption border-b" style={{ color: "var(--ws-red)", borderColor: "var(--ws-border)" }}>
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col px-3 pb-2 pt-2 min-w-0">
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-rows-[auto_auto_minmax(0,1fr)] xl:grid-cols-2 xl:gap-x-3 xl:gap-y-2 min-h-0">
          <div className="grid grid-cols-2 gap-x-3 items-baseline shrink-0 pb-1 xl:pb-0 xl:col-span-2">
            <div className="text-ws-title font-semibold tracking-tight" style={{ color: "var(--ws-text)" }}>
              Stocks in Play
            </div>
            <div className="text-ws-title font-semibold tracking-tight" style={{ color: "var(--ws-text)" }}>
              Top Movers
            </div>
          </div>

          <div className="hidden xl:block xl:row-start-2 xl:col-start-1 min-h-0" aria-hidden />

          <div
            className="shrink-0 flex flex-wrap items-end gap-x-3 gap-y-2 pb-2 xl:pb-0 xl:row-start-2 xl:col-start-2 border-b xl:border-b-0"
            style={{ borderColor: "var(--ws-border)" }}
          >
            <span className="sr-only">Premarket scan filters</span>
            {filterInput("Min Price ($)", minPrice, setMinPrice, { narrow: true })}
            {filterInput("Min Gap %", minGapPct, setMinGapPct, { narrow: true })}
            {filterInput("Min PM Volume", minPmVolume, setMinPmVolume, { thousands: true })}
            {filterInput("Min Avg Volume", minAvgVolume, setMinAvgVolume, { thousands: true })}
            {filterInput("Min Market Cap ($)", minMarketCap, setMinMarketCap, { thousands: true })}
            {filterInput("Max rows", moversMaxRows, setMoversMaxRows, { narrow: true })}
            <button
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-ws-label font-semibold transition-opacity ws-focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "rgba(0,229,204,0.12)",
                color: "var(--ws-cyan)",
                border: "1px solid rgba(0,229,204,0.25)",
              }}
            >
              {loading ? (
                <span className="inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
              ) : null}
              Refresh
            </button>
            {fetchedAt && !error ? (
              <span className="text-ws-caption tabular-nums pb-1.5 whitespace-nowrap" style={{ color: "var(--ws-text-vdim)" }}>
                Last fetch: {new Date(fetchedAt).toLocaleString()}
              </span>
            ) : null}
            <span className="text-ws-caption pb-1.5 w-full sm:w-auto" style={{ color: "var(--ws-text-vdim)" }}>
              Thresholds &amp; max rows saved on change. <strong>Refresh</strong> runs the scan.
            </span>
          </div>

          <div
            className="min-h-0 flex flex-col overflow-auto rounded border gap-2 p-2 xl:row-start-3 xl:col-start-1"
            style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
          >
            {loading && movers.length === 0 ? (
              <div className="py-8 text-center text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
                Loading…
              </div>
            ) : movers.length === 0 ? (
              <div
                className="py-8 px-4 text-center text-ws-body leading-relaxed max-w-prose mx-auto"
                style={{ color: "var(--ws-text-vdim)" }}
              >
                {sipEmptyHint ?? (
                  <>
                    <strong>Refresh</strong> loads the premarket scan. Stocks in Play lists the top {SIP_TABLE_MAX_ROWS} by gap %
                    from that result. Sessions roll at 4:00 AM Eastern; prior days are in SIP Archive below.
                  </>
                )}
              </div>
            ) : (
              sipRowsDisplayed.map((row) => (
                <SipGainerCard
                  key={row.ticker}
                  row={row}
                  entry={catalystMap[row.ticker]}
                  loading={Boolean(catalystLoading[row.ticker])}
                  selected={
                    Boolean(selectedSymbol) && row.ticker.toUpperCase() === selectedSymbol.toUpperCase()
                  }
                  onSelect={() => onSymbolSelect(row.ticker)}
                />
              ))
            )}
          </div>

          <div
            className="min-h-0 overflow-auto rounded border xl:row-start-3 xl:col-start-2 flex flex-col"
            style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
          >
              <table className="w-full text-left border-collapse" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {(() => {
                    const t = gapColWidths.reduce((a, b) => a + b, 0) || 1;
                    return gapColWidths.map((w, i) => (
                      <col key={i} style={{ width: `${(100 * w) / t}%` }} />
                    ));
                  })()}
                </colgroup>
                <thead className="sticky top-0 z-[1]" style={{ background: "var(--ws-bg3)" }}>
                  <tr>
                    <ResizableTh align="center" colIdx={0} showHandle onResizePointerDown={onGapColResizePointerDown}>
                      Ticker
                    </ResizableTh>
                    <ResizableTh align="center" colIdx={1} showHandle onResizePointerDown={onGapColResizePointerDown}>
                      Company
                    </ResizableTh>
                    <ResizableTh align="center" colIdx={2} showHandle onResizePointerDown={onGapColResizePointerDown}>
                      Price
                    </ResizableTh>
                    <ResizableTh align="center" colIdx={3} showHandle onResizePointerDown={onGapColResizePointerDown}>
                      Gap %
                    </ResizableTh>
                    <ResizableTh align="center" colIdx={4} showHandle onResizePointerDown={onGapColResizePointerDown}>
                      PM Volume
                    </ResizableTh>
                    <ResizableTh align="center" colIdx={5} showHandle onResizePointerDown={onGapColResizePointerDown}>
                      Vol %
                    </ResizableTh>
                    <ResizableTh align="center" colIdx={6} showHandle={false} onResizePointerDown={onGapColResizePointerDown}>
                      Market Cap
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {topMoverRows.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
                        {movers.length === 0
                          ? "No data. Check API key or refresh."
                          : "No rows to show — increase Max rows."}
                      </td>
                    </tr>
                  ) : (
                    topMoverRows.map((row) => (
                      <tr
                        key={row.ticker}
                        className="border-b cursor-pointer ws-row-hover ws-focus-ring"
                        style={{
                          borderColor: "var(--ws-border)",
                          background:
                            selectedSymbol && row.ticker.toUpperCase() === selectedSymbol.toUpperCase()
                              ? "rgba(0,229,204,0.15)"
                              : undefined,
                        }}
                        onClick={() => onSymbolSelect(row.ticker)}
                      >
                        <td
                          className="py-1.5 px-1.5 font-mono text-ws-body font-semibold whitespace-nowrap"
                          style={{ color: "var(--ws-cyan)" }}
                        >
                          {row.ticker}
                        </td>
                        <td className="py-1.5 px-1.5 text-ws-body min-w-0 truncate" style={{ color: "var(--ws-text)" }} title={row.name}>
                          {row.name}
                        </td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text)" }}>
                          {fmtPrice(row.lastPrice)}
                        </td>
                        <td
                          className="py-1.5 px-1.5 text-right tabular-nums text-ws-body font-medium whitespace-nowrap"
                          style={{ color: row.gapPct >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}
                        >
                          {fmtPct(row.gapPct)}
                        </td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text)" }}>
                          {fmtVol(row.pmVolume)}
                        </td>
                        <td
                          className={`py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap ${
                            row.volRatioPct != null && row.volRatioPct > 30 ? "font-medium" : ""
                          }`}
                          style={{
                            color:
                              row.volRatioPct != null && row.volRatioPct > 30
                                ? "var(--ws-green)"
                                : "var(--ws-text-dim)",
                          }}
                        >
                          {row.volRatioPct != null ? fmtPct(row.volRatioPct) : "—"}
                        </td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
                          {fmtMcap(row.marketCap)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
        </div>
      </div>

      <div
        className="shrink-0 flex flex-col border-t px-3 py-3 gap-3"
        style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg2)" }}
      >
        <div
          className="rounded-lg overflow-hidden min-h-[360px] h-[min(48vh,560px)] flex flex-col"
          style={{
            border: "1px solid var(--ws-border)",
            background: "var(--ws-bg)",
            boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
            <div className="flex min-h-[300px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
              <StockChart
                symbol={selectedSymbol}
                data={candles}
                loading={chartLoading}
                onRetryLoad={onChartRetry}
                timeframe={chartTimeframe}
                onTimeframeChange={onChartTimeframeChange}
                dualModeEnabled={false}
                showGlobalControls
                chartInstanceId="premarket"
                stockFlag={stockFlag}
                onFlagChange={onFlagChange}
                watchlistPickerLists={watchlistPickerLists}
                onWatchlistMembershipSave={onWatchlistMembershipSave}
              />
            </div>
          </div>
        </div>

        <div
          className="rounded-lg overflow-hidden flex flex-col max-h-[min(32vh,280px)] min-h-0"
          style={{ border: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}
        >
          <div
            className="shrink-0 px-3 py-2 border-b text-ws-title font-semibold tracking-tight"
            style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg3)", color: "var(--ws-text)" }}
          >
            SIP Archive
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {ledgerDatesDesc.length === 0 ? (
              <p className="px-3 py-4 text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
                Completed sessions with at least one SIP name appear here after the premarket session rolls at 4:00 AM Eastern
                (or on your next visit).
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--ws-border)" }}>
                {ledgerDatesDesc.map((ymd) => {
                  const day = ledger[ymd];
                  if (!day) return null;
                  const tickersLine = [...day.tickers]
                    .map((t) => {
                      const r = day.rows[t];
                      const g = r && Number.isFinite(r.gapPct) ? r.gapPct : Number.NEGATIVE_INFINITY;
                      return { t, g };
                    })
                    .sort((a, b) => b.g - a.g)
                    .map((x) => x.t)
                    .join(", ");
                  const open = ledgerExpandedYmd === ymd;
                  return (
                    <li key={ymd}>
                      <button
                        type="button"
                        onClick={() => setLedgerExpandedYmd((prev) => (prev === ymd ? null : ymd))}
                        className="w-full text-left px-3 py-2.5 text-ws-body ws-focus-ring transition-colors hover:opacity-95"
                        style={{
                          background: open ? "rgba(0,229,204,0.08)" : undefined,
                          color: "var(--ws-text)",
                        }}
                      >
                        <span className="font-medium">{formatLedgerHeading(ymd)}</span>
                        <span className="font-medium" style={{ color: "var(--ws-text-dim)" }}>
                          {" "}
                          SIP:{" "}
                        </span>
                        <span className="font-mono text-ws-body font-semibold" style={{ color: "var(--ws-cyan)" }}>
                          {tickersLine || "—"}
                        </span>
                      </button>
                      {open && (
                        <div className="px-2 pb-3 overflow-x-auto" style={{ background: "var(--ws-bg2)" }}>
                          <table
                            className="w-full text-left border-collapse rounded border overflow-hidden"
                            style={{
                              borderColor: "var(--ws-border)",
                              tableLayout: "fixed",
                              minWidth: Math.max(640, sipColWidths.reduce((a, b) => a + b, 0) + 200),
                            }}
                          >
                            <colgroup>
                              {sipColWidths.map((w, i) => (
                                <col key={i} style={{ width: w }} />
                              ))}
                              <col />
                            </colgroup>
                            <thead style={{ background: "var(--ws-bg3)" }}>
                              <tr>
                                <ResizableTh align="center" colIdx={0} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  #
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={1} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Ticker
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={2} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Company
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={3} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Prev. Close
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={4} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Price
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={5} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Gap %
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={6} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  PM Volume
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={7} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Avg Volume (1M)
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={8} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Volume %
                                </ResizableTh>
                                <ResizableTh align="center" colIdx={9} showHandle onResizePointerDown={onSipColResizePointerDown}>
                                  Market Cap
                                </ResizableTh>
                                <th
                                  className="py-2 px-1.5 text-center text-ws-body font-semibold border-b align-bottom box-border"
                                  style={{ ...thBorderStyle, overflow: "hidden" }}
                                >
                                  Catalyst
                                </th>
                              </tr>
                            </thead>
                            <tbody style={{ background: "var(--ws-bg)" }}>
                              {ledgerExpandedRows.map((row, i) =>
                                renderRow(row, {
                                  rank: i + 1,
                                  showCatalyst: true,
                                  catalystMapOverride: day.catalyst ?? {},
                                  skipCatalystLoading: true,
                                  rowKey: `${ymd}-${row.ticker}`,
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
