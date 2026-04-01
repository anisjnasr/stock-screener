"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { type WorkspaceSection, WORKSPACE_SECTIONS } from "@/types/workspace";
import {
  type StockFlag,
  loadFavoriteWatchlistIds,
  toggleFavoriteWatchlist,
  saveFavoriteWatchlistIds,
  loadFlagNames,
  saveFlagName,
  defaultFlagListLabel,
} from "@/lib/watchlist-storage";
import { FULL_UNIVERSE_ID } from "@/components/WatchlistPanel";
import { loadFavoriteScreenIds, toggleFavoriteScreen, saveFavoriteScreenIds } from "@/lib/screener-storage";
import { isUSMarketOpen } from "@/lib/market-hours";
import ProfileIcon from "@/components/ProfileIcon";

type SearchSuggestion = { symbol: string; name?: string; exchange?: string };

const FLAG_COLORS: Record<StockFlag, string> = {
  red: "#EF4468",
  yellow: "#F5A524",
  green: "#3DDC84",
  blue: "#5C9EF5",
};

export type MarketSubTab = "indices" | "monitor";
export type SectorSubTab = "sectors" | "industries";
export type SectorTimeframe = "1d" | "1w" | "1m" | "q" | "6m" | "y" | "ytd";

const SECTOR_TF_LABELS: Record<SectorTimeframe, string> = {
  "1d": "Day", "1w": "1W", "1m": "1M", "q": "3M", "6m": "6M", "y": "1Y", "ytd": "YTD",
};

const FLAG_ORDER_KEY = "stock-research-flag-order";
const DEFAULT_FLAG_ORDER: StockFlag[] = ["blue", "yellow", "red", "green"];

function reorderByInsertBefore<T>(list: T[], from: number, insertBefore: number): T[] {
  const n = list.length;
  const clamped = Math.max(0, Math.min(insertBefore, n));
  const next = [...list];
  const [moved] = next.splice(from, 1);
  let to = clamped;
  if (from < clamped) to -= 1;
  to = Math.max(0, Math.min(to, next.length));
  next.splice(to, 0, moved);
  return next;
}

function flagListTitle(names: Record<string, string>, f: StockFlag): string {
  const custom = names[f]?.trim();
  return custom || defaultFlagListLabel(f);
}

type WorkspaceHeaderProps = {
  section: WorkspaceSection;
  onSectionChange: (s: WorkspaceSection) => void;
  symbol: string;
  onSymbolChange: (s: string) => void;
  searchValue: string;
  onSearchChange: (s: string) => void;
  onSearchSubmit: () => void;
  flags: Record<string, StockFlag>;
  onFlagFilter?: (flag: StockFlag | null) => void;
  activeFlagFilter?: StockFlag | null;
  onFlagListOpen?: (flag: StockFlag) => void;
  // Market contextual
  marketSubTab?: MarketSubTab;
  onMarketSubTabChange?: (t: MarketSubTab) => void;
  // Sectors contextual
  sectorSubTab?: SectorSubTab;
  onSectorSubTabChange?: (t: SectorSubTab) => void;
  sectorTimeframe?: SectorTimeframe;
  onSectorTimeframeChange?: (t: SectorTimeframe) => void;
  // Scans contextual
  scanList?: string[];
  activeScan?: string;
  onScanChange?: (name: string) => void;
  onNewScan?: () => void;
  onEditScan?: (name: string) => void;
  onCloneScan?: (name: string) => void;
  onDeleteScan?: (name: string) => void;
  onReorderScans?: (names: string[]) => void;
  // Lists contextual
  watchlistNames?: { id: string; name: string }[];
  activeWatchlistId?: string | null;
  onWatchlistChange?: (id: string) => void;
  onDeleteWatchlist?: (id: string) => void;
  onRenameList?: (id: string, newName: string) => void;
  onCloneList?: (id: string) => void;
  onReorderLists?: (ids: string[]) => void;
  onNewList?: () => void;
  lastUpdated?: string | null;
  railWidthPx?: number;
  rowCountDisplay?: string;
  headerActionsSlotRef?: (el: HTMLDivElement | null) => void;
};

function MarketStatusClock() {
  const [open, setOpen] = useState(() => isUSMarketOpen());
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const check = () => setOpen(isUSMarketOpen());
    const idOpen = setInterval(check, 30_000);
    const idClock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(idOpen);
      clearInterval(idClock);
    };
  }, []);

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
  const dotColor = open ? "#22c55e" : "#ef4444";

  return (
    <div
      className="flex items-center gap-2 shrink-0 mr-2 text-sm font-medium select-none tabular-nums"
      style={{ color: "var(--ws-text)" }}
    >
      <span
        className={`rounded-full shrink-0 ${open ? "animate-pulse" : ""}`}
        style={{
          width: 8,
          height: 8,
          background: dotColor,
          boxShadow: open ? `0 0 8px ${dotColor}` : "none",
        }}
        aria-hidden
      />
      <span>
        {timeStr} ET
      </span>
    </div>
  );
}

function Pill({
  on,
  children,
  onClick,
  small,
  color,
}: {
  on?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  small?: boolean;
  color?: string;
}) {
  return (
    <button
      type="button"
      draggable={false}
      onClick={onClick}
      aria-pressed={!!on}
      className={`transition-colors cursor-pointer font-semibold ws-focus-ring ${!on ? "hover:bg-white/[0.06]" : ""}`}
      style={{
        background: on ? "var(--ws-cyan)" : undefined,
        border: on ? "1px solid var(--ws-cyan)" : "1px solid transparent",
        color: on ? "var(--ws-bg, #0f0f0f)" : "var(--ws-text-dim)",
        padding: small ? "2px 6px" : "4px 12px",
        borderRadius: 4,
        fontSize: small ? 10 : 14,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function SubBarPill({
  label,
  count,
  dotColor,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  dotColor: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const bg = active ? `${dotColor}14` : "rgba(255,255,255,0.03)";
  const bgHover = active ? `${dotColor}28` : "rgba(255,255,255,0.09)";
  return (
    <button
      type="button"
      draggable={false}
      onClick={onClick}
      aria-pressed={!!active}
      className="flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ws-focus-ring select-none whitespace-nowrap"
      style={{
        background: bg,
        border: `1px solid ${active ? `${dotColor}40` : "rgba(255,255,255,0.10)"}`,
        color: active ? "#fff" : "var(--ws-text-dim)",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}
    >
      <span
        className="shrink-0 w-2 h-2 rounded-full"
        style={{ background: active ? dotColor : `${dotColor}90` }}
      />
      {label}
      {count != null && (
        <span className="tabular-nums" style={{ opacity: 0.55 }}>{count}</span>
      )}
    </button>
  );
}

function WorkspaceHeader({
  section,
  onSectionChange,
  symbol,
  onSymbolChange,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  flags,
  onFlagFilter,
  activeFlagFilter,
  onFlagListOpen,
  marketSubTab = "indices",
  onMarketSubTabChange,
  sectorSubTab = "sectors",
  onSectorSubTabChange,
  sectorTimeframe = "1w",
  onSectorTimeframeChange,
  scanList = [],
  activeScan = "",
  onScanChange,
  onNewScan,
  onEditScan,
  onCloneScan,
  onDeleteScan,
  onReorderScans,
  watchlistNames = [],
  activeWatchlistId,
  onWatchlistChange,
  onDeleteWatchlist,
  onRenameList,
  onCloneList,
  onReorderLists,
  onNewList,
  lastUpdated,
  railWidthPx = 0,
  rowCountDisplay,
  headerActionsSlotRef,
}: WorkspaceHeaderProps) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [scanDDOpen, setScanDDOpen] = useState(false);
  const [listDDOpen, setListDDOpen] = useState(false);
  const [favScreenIds, setFavScreenIds] = useState<string[]>(() => loadFavoriteScreenIds());
  const [favListIds, setFavListIds] = useState<string[]>(() => loadFavoriteWatchlistIds());
  const [dragScanIdx, setDragScanIdx] = useState<number | null>(null);
  const [dragListIdx, setDragListIdx] = useState<number | null>(null);
  const [scanDropInsertBefore, setScanDropInsertBefore] = useState<number | null>(null);
  const [listDropInsertBefore, setListDropInsertBefore] = useState<number | null>(null);
  const scanDropInsertRef = useRef<number | null>(null);
  const listDropInsertRef = useRef<number | null>(null);
  const scanDragFromRef = useRef<number | null>(null);
  const listDragFromRef = useRef<number | null>(null);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingListName, setEditingListName] = useState("");
  const [flagNames, setFlagNames] = useState<Record<string, string>>(() => loadFlagNames());
  const [editingFlag, setEditingFlag] = useState<StockFlag | null>(null);
  const [editingFlagName, setEditingFlagName] = useState("");
  const [flagOrder, setFlagOrder] = useState<StockFlag[]>(() => {
    if (typeof window === "undefined") return DEFAULT_FLAG_ORDER;
    try {
      const raw = localStorage.getItem(FLAG_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StockFlag[];
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {}
    return DEFAULT_FLAG_ORDER;
  });
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const scanDDRef = useRef<HTMLDivElement>(null);
  const listDDRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!searchValue.trim()) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    const t = setTimeout(() => {
      setSuggestionsLoading(true);
      fetch(`/api/search-symbol?query=${encodeURIComponent(searchValue.trim())}`)
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data.slice(0, 10) : [];
          setSuggestions(list);
          setSuggestionsOpen(list.length > 0);
          setHighlightedIndex(-1);
        })
        .catch(() => { setSuggestions([]); setSuggestionsOpen(false); })
        .finally(() => setSuggestionsLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [searchValue, symbol]);

  const selectSymbol = useCallback(
    (sym: string) => {
      onSearchChange("");
      onSymbolChange(sym);
      setSuggestionsOpen(false);
      setSuggestions([]);
      setHighlightedIndex(-1);
    },
    [onSearchChange, onSymbolChange]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
      if (scanDDRef.current && !scanDDRef.current.contains(e.target as Node)) {
        setScanDDOpen(false);
      }
      if (listDDRef.current && !listDDRef.current.contains(e.target as Node)) {
        setListDDOpen(false);
        setEditingListId(null);
        setEditingFlag(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!suggestionsOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
    } else if (e.key === "Enter" && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      e.preventDefault();
      selectSymbol(suggestions[highlightedIndex].symbol);
    } else if (e.key === "Escape") {
      setSuggestionsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const flagCounts = useMemo(
    () =>
      Object.values(flags).reduce<Partial<Record<StockFlag, number>>>((acc, f) => {
        acc[f] = (acc[f] ?? 0) + 1;
        return acc;
      }, {}),
    [flags]
  );

  const flagsWithStocks = useMemo(
    () => flagOrder.filter((f) => (flagCounts[f] ?? 0) > 0),
    [flagOrder, flagCounts]
  );

  const hasFlaggedStocks = flagsWithStocks.length > 0;

  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<Record<string, string>>).detail;
      if (d && typeof d === "object") setFlagNames(d);
    };
    window.addEventListener("stock-flag-names-changed", fn);
    return () => window.removeEventListener("stock-flag-names-changed", fn);
  }, []);

  const padR = railWidthPx > 0 ? railWidthPx + 14 : 12;

  return (
    <header className="shrink-0" style={{ background: "var(--ws-bg2)", borderBottom: "1px solid var(--ws-border)" }}>
      {/* ===== ROW 1 — Main Header ===== */}
      <div
        className="relative flex items-center h-[50px]"
        style={{ paddingLeft: 12, paddingRight: 12 }}
      >
        {/* Left: logo */}
        <img
          src="/brand/stockstalker-lockup.png"
          srcSet="/brand/stockstalker-lockup.png 1x, /brand/stockstalker-lockup@2x.png 2x"
          alt="Stock Stalker"
          className="h-10 w-auto shrink-0 opacity-90"
        />

        {/* Center: nav + search */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <nav className="flex items-center gap-1 pointer-events-auto">
            {WORKSPACE_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSectionChange(s.id)}
                className={`px-4 py-1.5 text-ws-title font-semibold uppercase tracking-wider transition-all cursor-pointer ws-focus-ring ${section !== s.id ? "hover:bg-white/5" : ""}`}
                aria-current={section === s.id ? "page" : undefined}
                style={{
                  background: section === s.id ? "rgba(255,255,255,0.06)" : undefined,
                  borderBottom: section === s.id ? "2px solid var(--ws-cyan)" : "2px solid transparent",
                  borderTop: "2px solid transparent",
                  borderLeft: "none",
                  borderRight: "none",
                  borderRadius: 0,
                  color: section === s.id ? "var(--ws-cyan)" : "var(--ws-text-dim)",
                }}
              >
                {s.label}
              </button>
            ))}

            <div ref={searchContainerRef} className="relative shrink-0 ml-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (suggestionsOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
                    selectSymbol(suggestions[highlightedIndex].symbol);
                  } else {
                    onSearchSubmit();
                  }
                }}
                className="flex items-center gap-1"
              >
                <div className="relative w-48">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ width: 15, height: 15, color: "var(--ws-text-dim)" }}
                  >
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                  </svg>
                  <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
                    onFocus={(e) => {
                      (e.target as HTMLInputElement).select();
                      if (suggestions.length > 0 || searchValue.trim().length > 0) setSuggestionsOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Search"
                    className="w-full rounded pl-7 pr-2 py-1.5 text-sm"
                    style={{
                      background: "var(--ws-bg3)",
                      color: "var(--ws-text)",
                      border: "1px solid rgba(255,255,255,0.18)",
                    }}
                    aria-label="Stock search"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={suggestionsOpen}
                    aria-controls="ws-search-suggestions"
                    aria-activedescendant={highlightedIndex >= 0 ? `ws-suggestion-${highlightedIndex}` : undefined}
                  />
                </div>
              </form>
              {suggestionsOpen && (
                <ul
                  id="ws-search-suggestions"
                  role="listbox"
                  className="absolute right-0 top-full z-50 mt-1 max-h-60 w-[28rem] max-w-[90vw] overflow-auto rounded py-1 shadow-lg"
                  style={{ background: "var(--ws-bg2)", border: "1px solid var(--ws-border-hover)" }}
                >
                  {suggestionsLoading ? (
                    <li className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>Searching…</li>
                  ) : (
                    suggestions.map((s, i) => (
                      <li
                        key={`${s.symbol}-${i}`}
                        id={`ws-suggestion-${i}`}
                        role="option"
                        aria-selected={i === highlightedIndex}
                        className="cursor-pointer px-3 py-1.5 text-xs flex items-center gap-3"
                        style={{ background: i === highlightedIndex ? "var(--ws-bg3)" : "transparent" }}
                        onMouseEnter={() => setHighlightedIndex(i)}
                        onMouseDown={(e) => { e.preventDefault(); selectSymbol(s.symbol); }}
                      >
                        <span className="font-medium font-mono shrink-0 min-w-[60px]" style={{ color: "var(--ws-text)" }}>
                          {s.symbol}
                        </span>
                        {s.name && typeof s.name === "string" && <span style={{ color: "var(--ws-text-dim)" }}>{s.name}</span>}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </nav>
        </div>

        {/* Right: updated + profile — always far-right */}
        <div className="ml-auto flex items-center gap-3 shrink-0 z-10">
          {lastUpdated && (
            <span className="shrink-0 text-ws-label tabular-nums" style={{ color: "rgba(201,209,217,0.45)" }}>
              {lastUpdated}
            </span>
          )}
          <ProfileIcon />
        </div>
      </div>

      {/* ===== ROW 2 — Sub-bar ===== */}
      <div
        className="flex items-center gap-2 h-[40px]"
        style={{ paddingLeft: 12, paddingRight: padR, borderTop: "1px solid var(--ws-border)" }}
      >
        {/* Section-specific content is below; market status/clock are right-aligned at the end of this row */}
        {section === "market" && (
          <div className="flex items-center gap-1 flex-1">
            {(["indices", "monitor"] as MarketSubTab[]).map((t) => (
              <Pill key={t} on={marketSubTab === t} onClick={() => onMarketSubTabChange?.(t)}>
                {t === "indices" ? "Indices" : "Market Monitor"}
              </Pill>
            ))}
          </div>
        )}

        {section === "sectors-industries" && (
          <div className="flex items-center gap-1.5 flex-1">
            {(["sectors", "industries"] as SectorSubTab[]).map((t) => (
              <Pill key={t} on={sectorSubTab === t} onClick={() => onSectorSubTabChange?.(t)}>
                {t === "industries" ? "Industries" : "Sectors"}
              </Pill>
            ))}
            {rowCountDisplay && (
              <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                ({rowCountDisplay})
              </span>
            )}
            <div className="shrink-0" style={{ width: 1, height: 16, background: "var(--ws-border)", margin: "0 2px" }} />
            {onSectorTimeframeChange && (
              <div className="flex items-center gap-0.5">
                {(["1d", "1w", "1m", "q", "6m", "y", "ytd"] as SectorTimeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => onSectorTimeframeChange(tf)}
                    className={`px-2 py-0.5 text-sm font-medium rounded transition-colors cursor-pointer ws-focus-ring ${sectorTimeframe !== tf ? "hover:bg-white/[0.06]" : ""}`}
                    style={{
                      background: sectorTimeframe === tf ? "rgba(0,229,204,0.12)" : undefined,
                      color: sectorTimeframe === tf ? "var(--ws-cyan)" : "var(--ws-text-vdim)",
                      border: sectorTimeframe === tf ? "1px solid rgba(0,229,204,0.2)" : "1px solid transparent",
                    }}
                    aria-pressed={sectorTimeframe === tf}
                  >
                    {SECTOR_TF_LABELS[tf]}
                  </button>
                ))}
              </div>
            )}
            <div ref={section === "sectors-industries" ? headerActionsSlotRef : undefined} className="flex items-center gap-1" />
          </div>
        )}

        {section === "scans" && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div ref={scanDDRef} className="relative">
              <button
                type="button"
                onClick={() => setScanDDOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1 rounded text-sm font-semibold cursor-pointer"
                style={{
                  background: "var(--ws-bg3)",
                  border: "1px solid var(--ws-border)",
                  color: "var(--ws-text)",
                  minWidth: 140,
                }}
              >
                {activeScan || "Select scan"}
              </button>
              {scanDDOpen && scanList.length > 0 && (
                <div
                  className="absolute top-full left-0 mt-1 z-50 rounded py-1 min-w-[180px] max-h-60 overflow-auto shadow-lg"
                  style={{ background: "var(--ws-bg3)", border: "1px solid var(--ws-border-hover)" }}
                  onDragOver={(e) => {
                    if (scanDragFromRef.current == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                >
                  {scanList.map((s, idx) => {
                    const isFav = favScreenIds.includes(s);
                    return (
                      <Fragment key={s}>
                        {dragScanIdx != null && scanDropInsertBefore === idx && (
                          <div
                            className="mx-2 h-0.5 rounded-full shrink-0 my-0.5"
                            style={{ background: "var(--ws-cyan)" }}
                            aria-hidden
                          />
                        )}
                        <div
                        draggable
                        onDragStart={() => {
                          setDragScanIdx(idx);
                          scanDragFromRef.current = idx;
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (scanDragFromRef.current == null) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const insertBefore = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                          scanDropInsertRef.current = insertBefore;
                          setScanDropInsertBefore(insertBefore);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = scanDragFromRef.current;
                          if (from == null) return;
                          let insertBefore = scanDropInsertRef.current;
                          if (insertBefore == null) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            insertBefore = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                          }
                          insertBefore = Math.max(0, Math.min(insertBefore, scanList.length));
                          const reordered = reorderByInsertBefore(scanList, from, insertBefore);
                          if (!reordered.every((item, i) => item === scanList[i])) {
                            onReorderScans?.(reordered);
                          }
                          setDragScanIdx(null);
                          setScanDropInsertBefore(null);
                          scanDropInsertRef.current = null;
                          scanDragFromRef.current = null;
                        }}
                        onDragEnd={() => {
                          setDragScanIdx(null);
                          setScanDropInsertBefore(null);
                          scanDropInsertRef.current = null;
                          scanDragFromRef.current = null;
                        }}
                        className="group/sc px-3 py-1.5 text-xs rounded mx-1 transition-colors flex items-center"
                        style={{
                          color: s === activeScan ? "var(--ws-cyan)" : "var(--ws-text)",
                          background: s === activeScan ? "rgba(0,229,204,0.08)" : "transparent",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = s === activeScan ? "rgba(0,229,204,0.08)" : "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = s === activeScan ? "rgba(0,229,204,0.08)" : "transparent"; }}
                      >
                        <span
                          className="text-ws-body"
                          style={{ color: isFav ? "var(--ws-yellow, #ffc107)" : "var(--ws-text-vdim, #555)", marginRight: 8, cursor: "pointer" }}
                          onClick={(e) => { e.stopPropagation(); setFavScreenIds(toggleFavoriteScreen(s)); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setFavScreenIds(toggleFavoriteScreen(s));
                            }
                          }}
                        >
                          {isFav ? "★" : "☆"}
                        </span>
                        <span
                          className="flex-1 truncate cursor-pointer min-w-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onScanChange?.(s);
                            setScanDDOpen(false);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onScanChange?.(s);
                              setScanDDOpen(false);
                            }
                          }}
                        >
                          {s}
                        </span>
                        <span className="ml-2 shrink-0 flex items-center gap-0.5 opacity-0 group-hover/sc:opacity-100 transition-opacity">
                          <span
                            className="rounded p-0.5 hover:bg-white/10 cursor-pointer"
                            title={`Edit ${s}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onEditScan?.(s);
                              setScanDDOpen(false);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" /></svg>
                          </span>
                          <span
                            className="rounded p-0.5 hover:bg-white/10 cursor-pointer"
                            title={`Clone ${s}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onCloneScan?.(s);
                              setScanDDOpen(false);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z" /></svg>
                          </span>
                          <button
                            type="button"
                            className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-400 cursor-pointer border-0 bg-transparent inline-flex items-center justify-center shrink-0"
                            style={{ color: "inherit" }}
                            title={`Delete ${s}`}
                            aria-label={`Delete scan ${s}`}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const scanName = s;
                              queueMicrotask(() => {
                                if (!window.confirm(`Delete scan "${scanName}"? This cannot be undone.`)) return;
                                onDeleteScan?.(scanName);
                                setScanDDOpen(false);
                              });
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg>
                          </button>
                        </span>
                      </div>
                      </Fragment>
                    );
                  })}
                  {dragScanIdx != null && scanDropInsertBefore === scanList.length && (
                    <div
                      className="mx-2 h-0.5 rounded-full shrink-0 my-0.5"
                      style={{ background: "var(--ws-cyan)" }}
                      aria-hidden
                    />
                  )}
                </div>
              )}
            </div>
            {rowCountDisplay && (
              <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                ({rowCountDisplay})
              </span>
            )}
            <button
              type="button"
              onClick={onNewScan}
              className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded cursor-pointer transition-colors hover:brightness-150"
              style={{ color: "rgba(201,209,217,0.5)" }}
              title="New Scan"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            </button>
            <div ref={section === "scans" ? headerActionsSlotRef : undefined} className="flex items-center gap-0.5" />
            <div className="flex-1" />
            {(() => {
              const visibleFavs = favScreenIds.filter((id) => scanList.includes(id));
              if (visibleFavs.length === 0 && !hasFlaggedStocks) return null;
              return (
                <div className="flex items-center justify-center gap-1.5 min-w-0 overflow-x-auto">
                  {visibleFavs.map((s, i) => (
                    <div
                      key={s}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/scan-fav-idx", String(i)); }}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/scan-fav-idx")) e.preventDefault(); }}
                      onDrop={(e) => {
                        const raw = e.dataTransfer.getData("application/scan-fav-idx");
                        if (!raw) return;
                        const fromIdx = Number(raw);
                        if (fromIdx !== i && !isNaN(fromIdx)) {
                          const reordered = [...favScreenIds];
                          const [moved] = reordered.splice(fromIdx, 1);
                          reordered.splice(i, 0, moved);
                          setFavScreenIds(reordered);
                          saveFavoriteScreenIds(reordered);
                        }
                      }}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <SubBarPill label={s} dotColor="#00e5cc" active={activeScan === s} onClick={() => onScanChange?.(s)} />
                    </div>
                  ))}
                  {hasFlaggedStocks &&
                    flagsWithStocks.map((f) => {
                      const fi = flagOrder.indexOf(f);
                      const cnt = flagCounts[f] ?? 0;
                      const active = activeFlagFilter === f;
                      return (
                        <div
                          key={f}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/flag-idx", String(fi));
                          }}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes("application/flag-idx")) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            const raw = e.dataTransfer.getData("application/flag-idx");
                            if (!raw) return;
                            const fromIdx = Number(raw);
                            if (fromIdx !== fi && !isNaN(fromIdx)) {
                              const reordered = [...flagOrder];
                              const [moved] = reordered.splice(fromIdx, 1);
                              reordered.splice(fi, 0, moved);
                              setFlagOrder(reordered);
                              localStorage.setItem(FLAG_ORDER_KEY, JSON.stringify(reordered));
                            }
                          }}
                          className="cursor-grab active:cursor-grabbing"
                        >
                          <SubBarPill
                            label={flagListTitle(flagNames, f)}
                            count={cnt}
                            dotColor={FLAG_COLORS[f]}
                            active={active}
                            onClick={() => {
                              onWatchlistChange?.(`__flag_${f}__`);
                              onFlagFilter?.(active ? null : f);
                              onFlagListOpen?.(f);
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              );
            })()}
            <div className="flex-1" />
          </div>
        )}

        {section === "lists" && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div ref={listDDRef} className="relative">
              <button
                type="button"
                onClick={() => setListDDOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1 rounded text-sm font-semibold cursor-pointer"
                style={{
                  background: "var(--ws-bg3)",
                  border: "1px solid var(--ws-border)",
                  color: "var(--ws-text)",
                  minWidth: 140,
                }}
              >
                {(() => {
                  const flagMatch = activeWatchlistId?.match(/^__flag_(\w+)__$/);
                  if (flagMatch) {
                    const f = flagMatch[1] as StockFlag;
                    return (
                      <>
                        <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: FLAG_COLORS[f] }} />
                        {flagListTitle(flagNames, f)}
                      </>
                    );
                  }
                  return watchlistNames.find((w) => w.id === activeWatchlistId)?.name || "Select list";
                })()}
              </button>
              {listDDOpen && (
                <div
                  className="absolute top-full left-0 mt-1 z-50 rounded py-1 min-w-[180px] max-h-60 overflow-auto shadow-lg"
                  style={{ background: "var(--ws-bg3)", border: "1px solid var(--ws-border-hover)" }}
                  onDragOver={(e) => {
                    if (listDragFromRef.current == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                >
                  {watchlistNames.map((wl, idx) => {
                    const isFav = favListIds.includes(wl.id);
                    const isDeletable = wl.id !== FULL_UNIVERSE_ID;
                    const selectList = () => {
                      if (editingListId) return;
                      onWatchlistChange?.(wl.id);
                      setListDDOpen(false);
                      setEditingListId(null);
                    };
                    return (
                      <Fragment key={wl.id}>
                        {dragListIdx != null && listDropInsertBefore === idx && (
                          <div
                            className="mx-2 h-0.5 rounded-full shrink-0 my-0.5"
                            style={{ background: "var(--ws-cyan)" }}
                            aria-hidden
                          />
                        )}
                      <div
                        draggable={isDeletable}
                        onDragStart={() => {
                          if (!isDeletable) return;
                          setDragListIdx(idx);
                          listDragFromRef.current = idx;
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (listDragFromRef.current == null) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const insertBefore = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                          listDropInsertRef.current = insertBefore;
                          setListDropInsertBefore(insertBefore);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = listDragFromRef.current;
                          if (from == null) return;
                          let insertBefore = listDropInsertRef.current;
                          if (insertBefore == null) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            insertBefore = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                          }
                          insertBefore = Math.max(0, Math.min(insertBefore, watchlistNames.length));
                          const reordered = reorderByInsertBefore(watchlistNames, from, insertBefore);
                          const prevIds = watchlistNames.map((w) => w.id);
                          const nextIds = reordered.map((w) => w.id);
                          if (nextIds.some((id, i) => id !== prevIds[i])) {
                            onReorderLists?.(nextIds);
                          }
                          setDragListIdx(null);
                          setListDropInsertBefore(null);
                          listDropInsertRef.current = null;
                          listDragFromRef.current = null;
                        }}
                        onDragEnd={() => {
                          setDragListIdx(null);
                          setListDropInsertBefore(null);
                          listDropInsertRef.current = null;
                          listDragFromRef.current = null;
                        }}
                        className="group/wl px-3 py-1.5 text-xs rounded mx-1 transition-colors flex items-center"
                        style={{
                          color: activeWatchlistId === wl.id ? "var(--ws-cyan)" : "var(--ws-text)",
                          background: activeWatchlistId === wl.id ? "rgba(0,229,204,0.08)" : "transparent",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = activeWatchlistId === wl.id ? "rgba(0,229,204,0.08)" : "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = activeWatchlistId === wl.id ? "rgba(0,229,204,0.08)" : "transparent"; }}
                      >
                        <span
                          className="text-ws-body"
                          style={{ color: isFav ? "var(--ws-yellow, #ffc107)" : "var(--ws-text-vdim, #555)", marginRight: 8, cursor: "pointer" }}
                          onClick={(e) => { e.stopPropagation(); setFavListIds(toggleFavoriteWatchlist(wl.id)); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setFavListIds(toggleFavoriteWatchlist(wl.id));
                            }
                          }}
                        >
                          {isFav ? "★" : "☆"}
                        </span>
                        {editingListId === wl.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingListName}
                            onChange={(e) => setEditingListName(e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => {
                              const trimmed = editingListName.trim();
                              if (trimmed && trimmed !== wl.name) onRenameList?.(wl.id, trimmed);
                              setEditingListId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const trimmed = editingListName.trim();
                                if (trimmed && trimmed !== wl.name) onRenameList?.(wl.id, trimmed);
                                setEditingListId(null);
                              }
                              if (e.key === "Escape") setEditingListId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-transparent border-b outline-none text-xs px-0 py-0"
                            style={{ borderColor: "var(--ws-cyan)", color: "var(--ws-text)" }}
                          />
                        ) : (
                          <span
                            className="flex-1 truncate cursor-pointer min-w-0"
                            onClick={(e) => { e.stopPropagation(); selectList(); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                selectList();
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            {wl.name}
                          </span>
                        )}
                        {editingListId !== wl.id && (
                          <span className="ml-2 shrink-0 flex items-center gap-0.5 opacity-0 group-hover/wl:opacity-100 transition-opacity">
                            <span
                              className="rounded p-0.5 hover:bg-white/10 cursor-pointer"
                              title={`Rename ${wl.name}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingListId(wl.id);
                                setEditingListName(wl.name);
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" /></svg>
                            </span>
                            {isDeletable && (
                              <>
                                <span
                                  className="rounded p-0.5 hover:bg-white/10 cursor-pointer"
                                  title={`Clone ${wl.name}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onCloneList?.(wl.id);
                                    setListDDOpen(false);
                                  }}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z" /></svg>
                                </span>
                                <button
                                  type="button"
                                  className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-400 cursor-pointer border-0 bg-transparent inline-flex items-center justify-center shrink-0"
                                  style={{ color: "inherit" }}
                                  title={`Delete ${wl.name}`}
                                  aria-label={`Delete list ${wl.name}`}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const id = wl.id;
                                    const name = wl.name;
                                    queueMicrotask(() => {
                                      if (!window.confirm(`Delete list "${name}"? This cannot be undone.`)) return;
                                      onDeleteWatchlist?.(id);
                                      setListDDOpen(false);
                                    });
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg>
                                </button>
                              </>
                            )}
                          </span>
                        )}
                      </div>
                      </Fragment>
                    );
                  })}
                  {dragListIdx != null && listDropInsertBefore === watchlistNames.length && (
                    <div
                      className="mx-2 h-0.5 rounded-full shrink-0 my-0.5"
                      style={{ background: "var(--ws-cyan)" }}
                      aria-hidden
                    />
                  )}
                  {hasFlaggedStocks && (
                    <>
                      <div className="mx-2 my-1" style={{ height: 1, background: "var(--ws-border)" }} />
                      {flagsWithStocks.map((f) => {
                        const cnt = flagCounts[f] ?? 0;
                        const flagListId = `__flag_${f}__`;
                        const isActive = activeWatchlistId === flagListId;
                        const displayName = flagListTitle(flagNames, f);
                        const selectFlagList = () => {
                          if (editingFlag) return;
                          onWatchlistChange?.(flagListId);
                          onFlagFilter?.(isActive ? null : f);
                          onFlagListOpen?.(f);
                          setListDDOpen(false);
                          setEditingFlag(null);
                        };
                        const commitFlagRename = () => {
                          const trimmed = editingFlagName.trim();
                          if (!trimmed) {
                            setEditingFlag(null);
                            return;
                          }
                          if (trimmed !== displayName) setFlagNames(saveFlagName(f, trimmed));
                          setEditingFlag(null);
                        };
                        return (
                          <div
                            key={flagListId}
                            className="group/fg px-3 py-1.5 text-xs rounded mx-1 transition-colors flex items-center gap-2"
                            style={{
                              color: isActive ? "var(--ws-cyan)" : "var(--ws-text)",
                              background: isActive ? "rgba(0,229,204,0.08)" : "transparent",
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLElement).style.background = isActive
                                ? "rgba(0,229,204,0.08)"
                                : "rgba(255,255,255,0.06)";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.background = isActive
                                ? "rgba(0,229,204,0.08)"
                                : "transparent";
                            }}
                          >
                            <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: FLAG_COLORS[f] }} />
                            {editingFlag === f ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingFlagName}
                                onChange={(e) => setEditingFlagName(e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={commitFlagRename}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitFlagRename();
                                  }
                                  if (e.key === "Escape") setEditingFlag(null);
                                }}
                                onClick={(ev) => ev.stopPropagation()}
                                className="flex-1 min-w-0 bg-transparent border-b outline-none text-xs px-0 py-0"
                                style={{ borderColor: "var(--ws-cyan)", color: "var(--ws-text)" }}
                              />
                            ) : (
                              <span
                                className="flex-1 truncate cursor-pointer min-w-0"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  selectFlagList();
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(ev) => {
                                  if (ev.key === "Enter" || ev.key === " ") {
                                    ev.preventDefault();
                                    selectFlagList();
                                  }
                                }}
                              >
                                {displayName}
                              </span>
                            )}
                            {editingFlag !== f && (
                              <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/fg:opacity-100 transition-opacity">
                                <span
                                  className="rounded p-0.5 hover:bg-white/10 cursor-pointer"
                                  title={`Rename ${displayName}`}
                                  onClick={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    setEditingFlag(f);
                                    setEditingFlagName(displayName);
                                  }}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                    <path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" />
                                  </svg>
                                </span>
                              </span>
                            )}
                            <span className="ml-auto tabular-nums shrink-0" style={{ color: "var(--ws-text-dim)" }}>
                              {cnt}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
            {rowCountDisplay && (
              <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                ({rowCountDisplay})
              </span>
            )}
            <button
              type="button"
              onClick={onNewList}
              className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded cursor-pointer transition-colors hover:brightness-150"
              style={{ color: "rgba(201,209,217,0.5)" }}
              title="New List"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
            </button>
            <div ref={section === "lists" ? headerActionsSlotRef : undefined} className="flex items-center gap-0.5" />
            <div className="flex-1" />
            {(() => {
              const favLists = watchlistNames.filter((wl) => favListIds.includes(wl.id));
              if (favLists.length === 0 && !hasFlaggedStocks) return null;
              return (
                <div className="flex items-center justify-center gap-1.5 min-w-0 overflow-x-auto">
                  {favLists.map((wl, i) => (
                    <div
                      key={wl.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/list-fav-idx", String(i)); }}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/list-fav-idx")) e.preventDefault(); }}
                      onDrop={(e) => {
                        const raw = e.dataTransfer.getData("application/list-fav-idx");
                        if (!raw) return;
                        const fromIdx = Number(raw);
                        if (fromIdx !== i && !isNaN(fromIdx)) {
                          const reordered = [...favListIds];
                          const [moved] = reordered.splice(fromIdx, 1);
                          reordered.splice(i, 0, moved);
                          setFavListIds(reordered);
                          saveFavoriteWatchlistIds(reordered);
                        }
                      }}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <SubBarPill label={wl.name} dotColor="#00e5cc" active={activeWatchlistId === wl.id} onClick={() => onWatchlistChange?.(wl.id)} />
                    </div>
                  ))}
                  {hasFlaggedStocks &&
                    flagsWithStocks.map((f) => {
                      const fi = flagOrder.indexOf(f);
                      const cnt = flagCounts[f] ?? 0;
                      const active = activeFlagFilter === f;
                      return (
                        <div
                          key={f}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/flag-idx", String(fi));
                          }}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes("application/flag-idx")) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            const raw = e.dataTransfer.getData("application/flag-idx");
                            if (!raw) return;
                            const fromIdx = Number(raw);
                            if (fromIdx !== fi && !isNaN(fromIdx)) {
                              const reordered = [...flagOrder];
                              const [moved] = reordered.splice(fromIdx, 1);
                              reordered.splice(fi, 0, moved);
                              setFlagOrder(reordered);
                              localStorage.setItem(FLAG_ORDER_KEY, JSON.stringify(reordered));
                            }
                          }}
                          className="cursor-grab active:cursor-grabbing"
                        >
                          <SubBarPill
                            label={flagListTitle(flagNames, f)}
                            count={cnt}
                            dotColor={FLAG_COLORS[f]}
                            active={active}
                            onClick={() => {
                              onWatchlistChange?.(`__flag_${f}__`);
                              onFlagFilter?.(active ? null : f);
                              onFlagListOpen?.(f);
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              );
            })()}
            <div className="flex-1" />
          </div>
        )}

        <MarketStatusClock />
      </div>
    </header>
  );
}

export default memo(WorkspaceHeader);
