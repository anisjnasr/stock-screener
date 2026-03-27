"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { type WorkspaceSection, WORKSPACE_SECTIONS } from "@/types/workspace";
import { type StockFlag, loadFavoriteWatchlistIds, toggleFavoriteWatchlist } from "@/lib/watchlist-storage";
import { FULL_UNIVERSE_ID } from "@/components/WatchlistPanel";
import { loadFavoriteScreenIds, toggleFavoriteScreen } from "@/lib/screener-storage";
import { isUSMarketOpen } from "@/lib/market-hours";

type SearchSuggestion = { symbol: string; name?: string; exchange?: string };

const FLAG_COLORS: Record<StockFlag, string> = {
  red: "#9b2335",
  yellow: "#ff7200",
  green: "#15703a",
  blue: "#1a5fa0",
};

export type MarketSubTab = "indices" | "monitor";
export type SectorSubTab = "sectors" | "industries" | "thematic";
export type SectorTimeframe = "1d" | "1w" | "1m" | "q" | "6m" | "y" | "ytd";

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
  // Lists contextual
  watchlistNames?: { id: string; name: string }[];
  activeWatchlistId?: string | null;
  onWatchlistChange?: (id: string) => void;
  onDeleteWatchlist?: (id: string) => void;
  onNewList?: () => void;
  lastUpdated?: string | null;
  railWidthPx?: number;
};

function MarketStatusIndicator() {
  const [open, setOpen] = useState(() => isUSMarketOpen());

  useEffect(() => {
    const check = () => setOpen(isUSMarketOpen());
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const color = open ? "#22c55e" : "#ef4444";
  const label = open ? "MARKET OPEN" : "MARKET CLOSED";

  return (
    <div
      className="flex items-center gap-1.5 shrink-0 mr-2 text-[11px] tracking-wide font-medium select-none"
      style={{ color }}
    >
      <span
        className="rounded-full"
        style={{
          width: 7,
          height: 7,
          background: color,
          boxShadow: `0 0 5px ${color}`,
        }}
      />
      {label}
    </div>
  );
}

function ClockDisplay() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
  return (
    <span
      className="shrink-0 text-xs tabular-nums font-medium select-none"
      style={{ color: "#ffffff" }}
    >
      {timeStr}
    </span>
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
      onClick={onClick}
      className="transition-colors cursor-pointer font-semibold"
      style={{
        background: on ? "var(--ws-cyan)" : "transparent",
        border: on ? "1px solid var(--ws-cyan)" : "1px solid transparent",
        color: on ? "var(--ws-bg, #0f0f0f)" : "var(--ws-text-dim)",
        padding: small ? "2px 6px" : "4px 12px",
        borderRadius: 4,
        fontSize: small ? 10 : 12,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

export default function WorkspaceHeader({
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
  watchlistNames = [],
  activeWatchlistId,
  onWatchlistChange,
  onDeleteWatchlist,
  onNewList,
  lastUpdated,
  railWidthPx = 0,
}: WorkspaceHeaderProps) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [scanDDOpen, setScanDDOpen] = useState(false);
  const [listDDOpen, setListDDOpen] = useState(false);
  const [favScreenIds, setFavScreenIds] = useState<string[]>(() => loadFavoriteScreenIds());
  const [favListIds, setFavListIds] = useState<string[]>(() => loadFavoriteWatchlistIds());
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

  const flagCounts = Object.values(flags).reduce<Partial<Record<StockFlag, number>>>(
    (acc, f) => { acc[f] = (acc[f] ?? 0) + 1; return acc; },
    {}
  );

  const hasFlaggedStocks = Object.values(flagCounts).some((c) => (c ?? 0) > 0);

  const padR = railWidthPx > 0 ? railWidthPx + 14 : 12;

  return (
    <header className="shrink-0" style={{ background: "var(--ws-bg2)", borderBottom: "1px solid var(--ws-border)" }}>
      {/* ===== ROW 1 — Main Header ===== */}
      <div
        className="flex items-center gap-3 h-[42px]"
        style={{ paddingLeft: 12, paddingRight: padR }}
      >
        <img
          src="/brand/stockstalker-lockup.png"
          srcSet="/brand/stockstalker-lockup.png 1x, /brand/stockstalker-lockup@2x.png 2x"
          alt="Stock Stalker"
          className="h-8 w-auto shrink-0 opacity-90"
        />

        <nav className="flex items-center gap-1 ml-2">
          {WORKSPACE_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSectionChange(s.id)}
              className="px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wider transition-all cursor-pointer"
              style={{
                background: section === s.id ? "rgba(255,255,255,0.06)" : "transparent",
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
        </nav>

        <div className="flex-1" />

        <MarketStatusIndicator />
        <ClockDisplay />

        <div ref={searchContainerRef} className="relative shrink-0">
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
            <div className="relative w-44">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ width: 13, height: 13, color: "var(--ws-text-dim)" }}
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
                className="w-full rounded pl-7 pr-2 py-1 text-xs"
                style={{
                  background: "var(--ws-bg3)",
                  color: "var(--ws-text)",
                  border: "1px solid var(--ws-border-hover, rgba(255,255,255,0.12))",
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

        <div className="flex-1" />

        {lastUpdated && (
          <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "rgba(201,209,217,0.45)" }}>
            {lastUpdated}
          </span>
        )}
      </div>

      {/* ===== ROW 2 — Sub-bar ===== */}
      <div
        className="flex items-center gap-2 h-[34px]"
        style={{ paddingLeft: 12, paddingRight: padR, borderTop: "1px solid var(--ws-border)" }}
      >
        {section === "market" && (
          <div className="flex items-center gap-1">
            {(["indices", "monitor"] as MarketSubTab[]).map((t) => (
              <Pill key={t} on={marketSubTab === t} onClick={() => onMarketSubTabChange?.(t)}>
                {t === "indices" ? "Indices" : "Market Monitor"}
              </Pill>
            ))}
          </div>
        )}

        {section === "sectors-industries" && (
          <div className="flex items-center gap-1">
            {(["sectors", "industries", "thematic"] as SectorSubTab[]).map((t) => (
              <Pill key={t} on={sectorSubTab === t} onClick={() => onSectorSubTabChange?.(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Pill>
            ))}
            {hasFlaggedStocks && (
              <>
                <div className="shrink-0 mx-1" style={{ width: 1, height: 16, background: "var(--ws-border)" }} />
                <div className="flex items-center gap-1">
                  {(["blue", "yellow", "red", "green"] as StockFlag[]).map((f) => {
                    const cnt = flagCounts[f] ?? 0;
                    if (cnt === 0) return null;
                    return (
                      <button
                        key={f}
                        type="button"
                        className="transition-colors cursor-pointer font-medium"
                        style={{
                          background: FLAG_COLORS[f],
                          color: "#fff",
                          padding: "3px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: activeFlagFilter === f ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
                          fontFamily: "inherit",
                        }}
                        onClick={() => { onFlagFilter?.(activeFlagFilter === f ? null : f); onFlagListOpen?.(f); }}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)} ({cnt})
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {section === "scans" && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onNewScan}
            className="shrink-0 px-2.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors hover:brightness-150"
            style={{
              background: "rgba(0,229,204,0.06)",
              border: "1px solid rgba(0,229,204,0.25)",
              color: "var(--ws-cyan)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,229,204,0.18)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,229,204,0.06)"; }}
          >
            New Scan
            </button>
            <div ref={scanDDRef} className="relative">
              <button
                type="button"
                onClick={() => setScanDDOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1 rounded text-xs cursor-pointer"
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
                >
                  {scanList.map((s) => {
                    const isFav = favScreenIds.includes(s);
                    return (
                      <div
                        key={s}
                        className="group/sc px-3 py-1.5 text-xs cursor-pointer rounded mx-1 transition-colors flex items-center"
                        style={{
                          color: s === activeScan ? "var(--ws-cyan)" : "var(--ws-text-dim)",
                          background: s === activeScan ? "rgba(0,229,204,0.08)" : "transparent",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = s === activeScan ? "rgba(0,229,204,0.08)" : "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = s === activeScan ? "rgba(0,229,204,0.08)" : "transparent"; }}
                        onMouseDown={(e) => { e.preventDefault(); onScanChange?.(s); setScanDDOpen(false); }}
                      >
                        <span
                          className="text-[14px]"
                          style={{ color: isFav ? "var(--ws-yellow, #ffc107)" : "var(--ws-text-vdim, #555)", marginRight: 8, cursor: "pointer" }}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFavScreenIds(toggleFavoriteScreen(s)); }}
                        >
                          {isFav ? "★" : "☆"}
                        </span>
                        <span className="flex-1 truncate">{s}</span>
                        <span className="ml-2 shrink-0 flex items-center gap-0.5 opacity-0 group-hover/sc:opacity-100 transition-opacity">
                          <span
                            className="rounded p-0.5 hover:bg-white/10"
                            title={`Edit ${s}`}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onEditScan?.(s); setScanDDOpen(false); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" /></svg>
                          </span>
                          <span
                            className="rounded p-0.5 hover:bg-white/10"
                            title={`Clone ${s}`}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onCloneScan?.(s); setScanDDOpen(false); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z" /></svg>
                          </span>
                          <span
                            className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-400"
                            title={`Delete ${s}`}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteScan?.(s); setScanDDOpen(false); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg>
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {favScreenIds.filter((id) => scanList.includes(id)).length > 0 && (
              <>
                <div className="shrink-0" style={{ width: 1, height: 16, background: "var(--ws-border)", margin: "0 4px" }} />
                <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
                  {favScreenIds.filter((id) => scanList.includes(id)).map((s) => (
                    <Pill key={s} on={activeScan === s} onClick={() => onScanChange?.(s)}>
                      {s}
                    </Pill>
                  ))}
                </div>
              </>
            )}
            {hasFlaggedStocks && (
              <>
                <div className="shrink-0" style={{ width: 1, height: 16, background: "var(--ws-border)", margin: "0 4px" }} />
                <div className="flex items-center gap-1">
                  {(["blue", "yellow", "red", "green"] as StockFlag[]).map((f) => {
                    const cnt = flagCounts[f] ?? 0;
                    if (cnt === 0) return null;
                    return (
                      <button
                        key={f}
                        type="button"
                        className="transition-colors cursor-pointer font-medium"
                        style={{
                          background: FLAG_COLORS[f],
                          color: "#fff",
                          padding: "3px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: activeFlagFilter === f ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
                          fontFamily: "inherit",
                        }}
                        onClick={() => { onFlagFilter?.(activeFlagFilter === f ? null : f); onFlagListOpen?.(f); }}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)} ({cnt})
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {section === "lists" && (
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={onNewList}
            className="shrink-0 px-2.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors"
            style={{
              background: "rgba(0,229,204,0.06)",
              border: "1px solid rgba(0,229,204,0.25)",
              color: "var(--ws-cyan)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,229,204,0.18)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,229,204,0.06)"; }}
          >
            New List
            </button>
            <div ref={listDDRef} className="relative">
              <button
                type="button"
                onClick={() => setListDDOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1 rounded text-xs cursor-pointer"
                style={{
                  background: "var(--ws-bg3)",
                  border: "1px solid var(--ws-border)",
                  color: "var(--ws-text)",
                  minWidth: 140,
                }}
              >
                {watchlistNames.find((w) => w.id === activeWatchlistId)?.name || "Select list"}
              </button>
              {listDDOpen && watchlistNames.length > 0 && (
                <div
                  className="absolute top-full left-0 mt-1 z-50 rounded py-1 min-w-[180px] max-h-60 overflow-auto shadow-lg"
                  style={{ background: "var(--ws-bg3)", border: "1px solid var(--ws-border-hover)" }}
                >
                  {watchlistNames.map((wl) => {
                    const isFav = favListIds.includes(wl.id);
                    const isDeletable = wl.id !== FULL_UNIVERSE_ID;
                    return (
                      <div
                        key={wl.id}
                        className="group/wl px-3 py-1.5 text-xs cursor-pointer rounded mx-1 transition-colors flex items-center"
                        style={{
                          color: activeWatchlistId === wl.id ? "var(--ws-cyan)" : "var(--ws-text-dim)",
                          background: activeWatchlistId === wl.id ? "rgba(0,229,204,0.08)" : "transparent",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = activeWatchlistId === wl.id ? "rgba(0,229,204,0.08)" : "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = activeWatchlistId === wl.id ? "rgba(0,229,204,0.08)" : "transparent"; }}
                        onMouseDown={(e) => { e.preventDefault(); onWatchlistChange?.(wl.id); setListDDOpen(false); }}
                      >
                        <span
                          className="text-[14px]"
                          style={{ color: isFav ? "var(--ws-yellow, #ffc107)" : "var(--ws-text-vdim, #555)", marginRight: 8, cursor: "pointer" }}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFavListIds(toggleFavoriteWatchlist(wl.id)); }}
                        >
                          {isFav ? "★" : "☆"}
                        </span>
                        <span className="flex-1 truncate">{wl.name}</span>
                        {isDeletable && (
                          <span
                            className="ml-2 shrink-0 opacity-0 group-hover/wl:opacity-100 transition-opacity rounded p-0.5 hover:bg-red-500/20 hover:text-red-400"
                            title={`Delete ${wl.name}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onDeleteWatchlist?.(wl.id);
                              setListDDOpen(false);
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {(() => {
              const favLists = watchlistNames.filter((wl) => favListIds.includes(wl.id));
              if (favLists.length === 0) return null;
              return (
                <>
                  <div className="shrink-0" style={{ width: 1, height: 16, background: "var(--ws-border)", margin: "0 4px" }} />
                  <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
                    {favLists.map((wl) => (
                      <Pill key={wl.id} on={activeWatchlistId === wl.id} onClick={() => onWatchlistChange?.(wl.id)}>
                        {wl.name}
                      </Pill>
                    ))}
                  </div>
                </>
              );
            })()}
            {hasFlaggedStocks && (
              <>
                <div className="shrink-0" style={{ width: 1, height: 16, background: "var(--ws-border)", margin: "0 4px" }} />
                <div className="flex items-center gap-1">
                  {(["blue", "yellow", "red", "green"] as StockFlag[]).map((f) => {
                    const cnt = flagCounts[f] ?? 0;
                    if (cnt === 0) return null;
                    return (
                      <button
                        key={f}
                        type="button"
                        className="transition-colors cursor-pointer font-medium"
                        style={{
                          background: FLAG_COLORS[f],
                          color: "#fff",
                          padding: "3px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: activeFlagFilter === f ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
                          fontFamily: "inherit",
                        }}
                        onClick={() => { onFlagFilter?.(activeFlagFilter === f ? null : f); onFlagListOpen?.(f); }}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)} ({cnt})
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
