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
  loadPremarketThresholds,
  PREMARKET_THRESHOLDS_DEFAULTS,
  savePremarketThresholds,
} from "@/lib/premarket-thresholds-storage";

const SIP_COL_WIDTHS_KEY = "premarket-sip-col-widths-v2";
const GAP_COL_WIDTHS_KEY = "premarket-gappers-col-widths-v3";

/** Wider mins so headers wrap inside cells instead of overlapping adjacent columns. */
const SIP_COL_MINS = [40, 60, 120, 58, 58, 70, 80, 96, 64, 76] as const;
const SIP_COL_DEFAULTS = [48, 76, 240, 68, 68, 78, 92, 108, 76, 96] as const;

/** Six explicit widths — no auto “fill” column, so Market Cap is not stretched across empty space. */
const GAP_COL_MINS = [56, 120, 54, 72, 80, 88] as const;
const GAP_COL_DEFAULTS = [72, 200, 62, 80, 92, 96] as const;

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

const SIP_STORAGE_PREFIX = "premarket-sip-v2:";
const SIP_ROWS_STORAGE_PREFIX = "premarket-sip-rows-v2:";

function sipStorageKey(): string {
  return `${SIP_STORAGE_PREFIX}${premarketSessionEtDateKey()}`;
}

function sipRowsStorageKey(): string {
  return `${SIP_ROWS_STORAGE_PREFIX}${premarketSessionEtDateKey()}`;
}

function sipCatalystStorageKey(ymd = premarketSessionEtDateKey()): string {
  return `premarket-sip-catalyst-v2:${ymd}`;
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
  const [minPmVolume, setMinPmVolume] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minPmVolume : PREMARKET_THRESHOLDS_DEFAULTS.minPmVolume
  );
  const [minGapPct, setMinGapPct] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minGapPct : PREMARKET_THRESHOLDS_DEFAULTS.minGapPct
  );
  const [minMarketCap, setMinMarketCap] = useState(() =>
    typeof window !== "undefined" ? loadPremarketThresholds().minMarketCap : PREMARKET_THRESHOLDS_DEFAULTS.minMarketCap
  );

  const [movers, setMovers] = useState<PremarketMoverRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  /** When SIP is empty but we have movers: explain that thresholds filtered everyone out. */
  const [sipEmptyHint, setSipEmptyHint] = useState<string | null>(null);

  const [premarketTab, setPremarketTab] = useState<"sip" | "gappers">("sip");
  const [ledger, setLedger] = useState<PremarketLedger>(() =>
    typeof window === "undefined" ? {} : loadLedger()
  );
  const [ledgerExpandedYmd, setLedgerExpandedYmd] = useState<string | null>(null);

  const [sipTickers, setSipTickers] = useState<string[]>([]);
  const [lastByTicker, setLastByTicker] = useState<Record<string, PremarketMoverRow>>({});
  const [catalystMap, setCatalystMap] = useState<Record<string, string>>({});
  const [catalystLoading, setCatalystLoading] = useState<Record<string, boolean>>({});
  const catalystMapRef = useRef<Record<string, string>>({});
  catalystMapRef.current = catalystMap;

  const sessionEtDateRef = useRef(premarketSessionEtDateKey());
  const sipStateRef = useRef({ sipTickers, lastByTicker, catalystMap });
  sipStateRef.current = { sipTickers, lastByTicker, catalystMap };
  const skipNextThresholdSaveRef = useRef(true);

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

  /** Archive completed premarket session (rolls 03:00 ET) into ledger; clear working keys; advance active session date. */
  useEffect(() => {
    try {
      const today = premarketSessionEtDateKey();
      const active = localStorage.getItem(ACTIVE_PREMARKET_SESSION_KEY);
      if (active && active !== today) {
        const rawT = localStorage.getItem(`${SIP_STORAGE_PREFIX}${active}`);
        const rawR = localStorage.getItem(`${SIP_ROWS_STORAGE_PREFIX}${active}`);
        const rawC = localStorage.getItem(`premarket-sip-catalyst-v2:${active}`);
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
            let catalyst: Record<string, string> | undefined;
            if (rawC) {
              try {
                const c = JSON.parse(rawC) as Record<string, string>;
                if (c && typeof c === "object") catalyst = c;
              } catch {
                /* ignore */
              }
            }
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
        localStorage.removeItem(`premarket-sip-catalyst-v2:${active}`);
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
      const raw = localStorage.getItem(sipStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const tickers = parsed.map((t) => String(t).toUpperCase()).filter(Boolean);
          setSipTickers(tickers);
        }
      }
      const rawCat = localStorage.getItem(sipCatalystStorageKey());
      if (rawCat) {
        const c = JSON.parse(rawCat) as Record<string, string>;
        if (c && typeof c === "object") setCatalystMap(c);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onProfile = () => {
      const t = loadPremarketThresholds();
      setMinPrice(t.minPrice);
      setMinPmVolume(t.minPmVolume);
      setMinGapPct(t.minGapPct);
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
    savePremarketThresholds({ minPrice, minPmVolume, minGapPct, minMarketCap });
  }, [minPrice, minPmVolume, minGapPct, minMarketCap]);

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
      const { sipTickers: st, lastByTicker: lb, catalystMap: cm } = sipStateRef.current;
      if (st.length > 0) {
        const nextLedger = mergeLedgerDay(loadLedger(), prev, {
          tickers: [...st],
          rows: { ...lb },
          catalyst: { ...cm },
        });
        saveLedger(nextLedger);
      }
      localStorage.setItem(ACTIVE_PREMARKET_SESSION_KEY, today);
      localStorage.removeItem(`${SIP_STORAGE_PREFIX}${prev}`);
      localStorage.removeItem(`${SIP_ROWS_STORAGE_PREFIX}${prev}`);
      localStorage.removeItem(`premarket-sip-catalyst-v2:${prev}`);
      setSipTickers([]);
      setLastByTicker({});
      setCatalystMap({});
      setLedger(loadLedger());
      setLedgerExpandedYmd(null);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(sipStorageKey(), JSON.stringify(sipTickers));
    } catch {
      /* ignore */
    }
  }, [sipTickers]);

  const refresh = useCallback(async () => {
    const mp = Number(minPrice);
    const mv = Number(minPmVolume);
    const mg = Number(minGapPct);
    const mc = Number(minMarketCap);
    if (![mp, mv, mg, mc].every((n) => Number.isFinite(n) && n >= 0)) {
      setError("Invalid filter values");
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      direction: "gainers",
      minPrice: String(mp),
      minPmVolume: String(mv),
      minGapPct: String(mg),
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
      const elig = data.eligibleNow ?? [];
      if (list.length > 0 && elig.length === 0) {
        setSipEmptyHint("No results");
      } else {
        setSipEmptyHint(null);
      }
      setMovers(list);
      setFetchedAt(data.fetchedAt ?? null);
      setLastByTicker((prev) => {
        const next = { ...prev };
        for (const r of list) next[r.ticker] = r;
        saveSipRowSnapshots(next);
        return next;
      });
      setSipTickers((prev) => {
        const s = new Set(prev);
        for (const r of elig) s.add(r.ticker);
        return [...s];
      });
    } catch {
      setError("Network error");
      setMovers([]);
      setSipEmptyHint(null);
    } finally {
      setLoading(false);
    }
  }, [minPrice, minPmVolume, minGapPct, minMarketCap]);

  useEffect(() => {
    void refresh();
    // Initial load only; filters apply on Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  const sipRows = useMemo(() => {
    return [...sipTickers]
      .map((t) => lastByTicker[t] ?? sipPlaceholderRow(t))
      .sort((a, b) => b.gapPct - a.gapPct);
  }, [sipTickers, lastByTicker]);

  const sipKey = useMemo(
    () =>
      [...new Set(sipRows.map((r) => r.ticker))]
        .sort()
        .join(","),
    [sipRows]
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
            results?: Record<string, { summary?: string }>;
          };
          if (!alive) return;
          const r = data.results ?? {};
          setCatalystMap((prev) => {
            const next = { ...prev };
            for (const m of missing) next[m] = (r[m]?.summary ?? "No news").trim() || "No news";
            return next;
          });
        } catch {
          if (alive) {
            setCatalystMap((prev) => {
              const next = { ...prev };
              for (const m of missing) next[m] = "No news";
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
      catalystMapOverride?: Record<string, string>;
      skipCatalystLoading?: boolean;
      rowKey?: string;
    }
  ) => {
    const catText =
      opts.catalystMapOverride != null
        ? opts.catalystMapOverride[row.ticker]
        : catalystMap[row.ticker];
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
      <div
        className="shrink-0 flex flex-wrap items-end gap-x-4 gap-y-2 px-3 py-2 border-b"
        style={{ borderColor: "var(--ws-border)" }}
      >
        <span className="shrink-0 text-ws-title font-semibold tracking-tight pb-1" style={{ color: "var(--ws-text)" }}>
          Scan Filters
        </span>
        <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
          {filterInput("Min Price ($)", minPrice, setMinPrice, { narrow: true })}
          {filterInput("Min PM Volume", minPmVolume, setMinPmVolume, { thousands: true })}
          {filterInput("Min Gap %", minGapPct, setMinGapPct, { narrow: true })}
          {filterInput("Min Market Cap ($)", minMarketCap, setMinMarketCap, { thousands: true })}
        </div>
        <div className="flex flex-wrap items-end gap-3 shrink-0 ml-auto">
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
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-3 py-1 text-ws-caption" style={{ color: "var(--ws-red)" }}>
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col px-3 pb-2 pt-1 min-w-0">
        <div className="shrink-0 flex gap-0.5 mb-0">
          <button
            type="button"
            role="tab"
            aria-selected={premarketTab === "sip"}
            onClick={() => setPremarketTab("sip")}
            className="px-2 sm:px-3 py-1.5 text-ws-title font-semibold uppercase tracking-wider transition-colors cursor-pointer ws-focus-ring text-xs sm:text-sm"
            style={{
              background: premarketTab === "sip" ? "rgba(255,255,255,0.06)" : undefined,
              borderBottom: premarketTab === "sip" ? "2px solid var(--ws-cyan)" : "2px solid transparent",
              borderTop: "2px solid transparent",
              borderLeft: "none",
              borderRight: "none",
              borderRadius: 0,
              color: premarketTab === "sip" ? "var(--ws-cyan)" : "var(--ws-text-dim)",
            }}
          >
            Stocks in Play
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={premarketTab === "gappers"}
            onClick={() => setPremarketTab("gappers")}
            className="px-2 sm:px-3 py-1.5 text-ws-title font-semibold uppercase tracking-wider transition-colors cursor-pointer ws-focus-ring text-xs sm:text-sm"
            style={{
              background: premarketTab === "gappers" ? "rgba(255,255,255,0.06)" : undefined,
              borderBottom: premarketTab === "gappers" ? "2px solid var(--ws-cyan)" : "2px solid transparent",
              borderTop: "2px solid transparent",
              borderLeft: "none",
              borderRight: "none",
              borderRadius: 0,
              color: premarketTab === "gappers" ? "var(--ws-cyan)" : "var(--ws-text-dim)",
            }}
          >
            Top Gappers
          </button>
        </div>

        <div
          className="flex-1 min-h-0 overflow-auto rounded border"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
        >
          {premarketTab === "sip" ? (
            <table
              className="w-full text-left border-collapse"
              style={{
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
              <thead className="sticky top-0 z-[1]" style={{ background: "var(--ws-bg3)" }}>
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
              <tbody>
                {sipRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="py-6 px-4 text-center text-ws-body leading-relaxed max-w-prose mx-auto"
                      style={{ color: "var(--ws-text-vdim)" }}
                    >
                      {sipEmptyHint ?? (
                        <>
                          Each ET session starts blank. <strong>Refresh</strong> loads gainers and adds tickers that pass{" "}
                          <strong>all</strong> thresholds (they stay until the session rolls at 3:00 AM Eastern). Prior sessions
                          are kept in SIP Archive below the chart—open a date to see that day&apos;s table.
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  sipRows.map((row, i) => renderRow(row, { rank: i + 1, showCatalyst: true }))
                )}
              </tbody>
            </table>
          ) : (
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
                  <ResizableTh align="center" colIdx={5} showHandle={false} onResizePointerDown={onGapColResizePointerDown}>
                    Market Cap
                  </ResizableTh>
                </tr>
              </thead>
              <tbody>
                {movers.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
                      No data. Check API key or refresh.
                    </td>
                  </tr>
                ) : (
                  movers.map((row) => (
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
                      <td className="py-1.5 px-1.5 text-right tabular-nums text-ws-body whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
                        {fmtMcap(row.marketCap)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
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
                Completed sessions with at least one SIP name appear here after the premarket session rolls at 3:00 AM Eastern
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
