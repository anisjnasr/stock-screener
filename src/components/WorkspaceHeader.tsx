"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { type WorkspaceSection, WORKSPACE_SECTIONS } from "@/types/workspace";
import { type StockFlag } from "@/lib/watchlist-storage";

type SearchSuggestion = { symbol: string; name?: string; exchange?: string };

const FLAG_COLORS: Record<StockFlag, string> = {
  red: "#ff4d6a",
  yellow: "#ffc107",
  green: "#22c55e",
  blue: "#4da6ff",
};

export type SectorSubTab = "sectors" | "industries" | "thematic";
export type SectorTimeframe = "1d" | "1w" | "1m" | "q" | "y" | "ytd";

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
  // Lists contextual
  watchlistNames?: { id: string; name: string }[];
  activeWatchlistId?: string | null;
  onWatchlistChange?: (id: string) => void;
  onNewList?: () => void;
  lastUpdated?: string | null;
};

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
      className="transition-colors cursor-pointer font-medium"
      style={{
        background: on ? "var(--ws-cyan-dim, rgba(0,229,204,0.08))" : "transparent",
        border: `1px solid ${on ? "rgba(0,229,204,0.2)" : "transparent"}`,
        color: on ? "var(--ws-cyan)" : "var(--ws-text-dim)",
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
  sectorSubTab = "sectors",
  onSectorSubTabChange,
  sectorTimeframe = "1w",
  onSectorTimeframeChange,
  scanList = [],
  activeScan = "",
  onScanChange,
  onNewScan,
  watchlistNames = [],
  activeWatchlistId,
  onWatchlistChange,
  onNewList,
  lastUpdated,
}: WorkspaceHeaderProps) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [scanDDOpen, setScanDDOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const scanDDRef = useRef<HTMLDivElement>(null);

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

  return (
    <header
      className="shrink-0 flex items-center gap-2 px-3 h-[42px]"
      style={{ background: "var(--ws-bg2)", borderBottom: "1px solid var(--ws-border)" }}
    >
      {/* Brand */}
      <img
        src="/brand/stockstalker-lockup.svg"
        alt="Stock Stalker"
        className="h-6 w-auto shrink-0 opacity-80"
      />

      {/* Section pills */}
      <nav className="flex items-center gap-0.5 rounded p-0.5 ml-3" style={{ background: "var(--ws-bg)" }}>
        {WORKSPACE_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSectionChange(s.id)}
            className="px-2.5 py-1 text-xs font-medium rounded transition-colors"
            style={{
              background: section === s.id ? "var(--ws-cyan)" : "transparent",
              color: section === s.id ? "var(--ws-bg)" : "var(--ws-text-dim)",
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="shrink-0" style={{ width: 1, height: 20, background: "var(--ws-border)", margin: "0 6px" }} />

      {/* ---- CONTEXTUAL CONTROLS ---- */}

      {section === "sectors-industries" && (
        <div className="flex items-center gap-1">
          {(["sectors", "industries", "thematic"] as SectorSubTab[]).map((t) => (
            <Pill key={t} on={sectorSubTab === t} onClick={() => onSectorSubTabChange?.(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Pill>
          ))}
          <div className="shrink-0 mx-1.5" style={{ width: 1, height: 16, background: "var(--ws-border)" }} />
          {(["1d", "1w", "1m", "q", "y", "ytd"] as SectorTimeframe[]).map((t) => (
            <Pill key={t} small on={sectorTimeframe === t} onClick={() => onSectorTimeframeChange?.(t)}>
              {t.toUpperCase()}
            </Pill>
          ))}
        </div>
      )}

      {section === "scans" && (
        <div className="flex items-center gap-1.5">
          {/* Scan dropdown */}
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
              <span style={{ color: "var(--ws-text-vdim)", fontSize: 10 }}>▾</span>
            </button>
            {scanDDOpen && scanList.length > 0 && (
              <div
                className="absolute top-full left-0 mt-1 z-50 rounded py-1 min-w-[180px] max-h-60 overflow-auto shadow-lg"
                style={{ background: "var(--ws-bg3)", border: "1px solid var(--ws-border-hover)" }}
              >
                {scanList.map((s) => (
                  <div
                    key={s}
                    className="px-3 py-1.5 text-xs cursor-pointer rounded mx-1 transition-colors"
                    style={{
                      color: s === activeScan ? "var(--ws-cyan)" : "var(--ws-text-dim)",
                      background: s === activeScan ? "rgba(0,229,204,0.08)" : "transparent",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = s === activeScan ? "rgba(0,229,204,0.08)" : "rgba(255,255,255,0.06)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = s === activeScan ? "rgba(0,229,204,0.08)" : "transparent"; }}
                    onMouseDown={(e) => { e.preventDefault(); onScanChange?.(s); setScanDDOpen(false); }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onNewScan}
            className="px-3 py-1 rounded text-[11px] font-medium cursor-pointer"
            style={{
              background: "rgba(0,229,204,0.08)",
              border: "1px solid rgba(0,229,204,0.2)",
              color: "var(--ws-cyan)",
            }}
          >
            + New
          </button>
          <div className="shrink-0 mx-1" style={{ width: 1, height: 16, background: "var(--ws-border)" }} />
          {/* Flag filters */}
          <div className="flex items-center gap-1">
            {(["blue", "yellow", "red", "green"] as StockFlag[]).map((f) => {
              const cnt = flagCounts[f] ?? 0;
              if (cnt === 0) return null;
              return (
                <Pill key={f} small on={activeFlagFilter === f} onClick={() => onFlagFilter?.(activeFlagFilter === f ? null : f)}>
                  <span className="inline-flex items-center gap-1">
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: FLAG_COLORS[f] }} />
                    {cnt}
                  </span>
                </Pill>
              );
            })}
          </div>
        </div>
      )}

      {section === "lists" && (
        <div className="flex items-center gap-1.5">
          {watchlistNames.slice(0, 6).map((wl) => (
            <Pill key={wl.id} on={activeWatchlistId === wl.id} onClick={() => onWatchlistChange?.(wl.id)}>
              {wl.name}
            </Pill>
          ))}
          <button
            type="button"
            onClick={onNewList}
            className="px-3 py-1 rounded text-[11px] font-medium cursor-pointer"
            style={{
              background: "rgba(0,229,204,0.08)",
              border: "1px solid rgba(0,229,204,0.2)",
              color: "var(--ws-cyan)",
            }}
          >
            + New
          </button>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
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
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
            onFocus={(e) => {
              (e.target as HTMLInputElement).select();
              if (suggestions.length > 0 || searchValue.trim().length > 0) setSuggestionsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search symbol…"
            className="w-36 rounded px-2 py-1 text-xs"
            style={{
              background: "var(--ws-bg)",
              color: "var(--ws-text)",
              border: "1px solid var(--ws-border)",
            }}
            aria-label="Stock search"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen}
            aria-controls="ws-search-suggestions"
            aria-activedescendant={highlightedIndex >= 0 ? `ws-suggestion-${highlightedIndex}` : undefined}
          />
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
                  {s.name && <span style={{ color: "var(--ws-text-dim)" }}>{s.name}</span>}
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <span className="shrink-0 text-[10px] tabular-nums ml-2" style={{ color: "var(--ws-text-vdim)" }}>
          {lastUpdated}
        </span>
      )}
    </header>
  );
}
