"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/hooks/useTheme";
import { formatDisplayDate } from "@/lib/date-format";

type SearchSuggestion = {
  symbol: string;
  name?: string;
  exchange?: string;
};

type Quote = {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  volume: number;
  yearHigh?: number;
  yearLow?: number;
  avgVolume?: number;
  marketCap?: number;
};

type Profile = {
  companyName: string;
  sector: string;
  industry: string;
  mktCap?: number;
} | undefined;

export type HeaderPage = "home" | "market-monitor" | "market-breadth" | "breadth";

type HeaderProps = {
  quote: Quote | null;
  profile: Profile;
  symbol: string;
  atrPct?: number;
  avgVolume30d?: number;
  computed52WHigh?: number | null;
  lastUpdate?: Date | null;
  onSymbolChange: (s: string) => void;
  searchValue: string;
  onSearchChange: (s: string) => void;
  onSearchSubmit: () => void;
  loading?: boolean;
  currentPage?: HeaderPage;
  onPageChange?: (page: HeaderPage) => void;
  latestDataDate?: string | null;
  leftSidebarHidden?: boolean;
  onLeftSidebarToggle?: () => void;
};

function fmtNum(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "NA";
  return (n / 1e9).toFixed(2);
}

function fmtPct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "NA";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function Header({
  quote,
  profile,
  symbol,
  atrPct,
  avgVolume30d,
  computed52WHigh,
  lastUpdate,
  onSymbolChange,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  loading,
  currentPage,
  onPageChange,
  latestDataDate,
  leftSidebarHidden = false,
  onLeftSidebarToggle,
}: HeaderProps) {
  const brandName = "Stock Stalker";
  const name = quote?.name ?? profile?.companyName ?? symbol;
  const price = quote?.price;
  const chgPct = quote?.changesPercentage;
  const vol = quote?.volume;
  const mktCap = quote?.marketCap ?? profile?.mktCap;
  const yHigh = computed52WHigh ?? quote?.yearHigh;
  const avgVol = avgVolume30d ?? quote?.avgVolume;
  const isUp = (chgPct ?? 0) >= 0;
  const off52WHighPct =
    price != null && yHigh != null && price !== 0 ? ((price - yHigh) / price) * 100 : null;

  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);

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
        .catch(() => {
          setSuggestions([]);
          setSuggestionsOpen(false);
        })
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

  const { theme, cycleTheme } = useTheme();

  return (
    <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div className="relative px-4 py-3">
        <div className="absolute right-2 sm:right-4 top-3 flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={cycleTheme}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors"
            aria-label={`Theme: ${theme}. Click to cycle.`}
            title={`Theme: ${theme}`}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            ) : theme === "light" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            )}
          </button>
          <img
            src="/brand/stockstalker-lockup.svg"
            alt={brandName}
            className="hidden sm:block h-8 w-auto"
          />
        </div>
        <div className="flex items-center justify-center pr-10 sm:pr-28">
          <div className="inline-flex items-center gap-0.5 sm:gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 p-0.5 sm:p-1">
            {[
              { id: "home" as HeaderPage, label: "Home", shortLabel: "Home" },
              { id: "market-breadth" as HeaderPage, label: "Sectors / Industries", shortLabel: "Sectors" },
              { id: "market-monitor" as HeaderPage, label: "Market Monitor", shortLabel: "Monitor" },
              { id: "breadth" as HeaderPage, label: "Breadth", shortLabel: "Breadth" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange?.(item.id)}
                className={`px-2 sm:px-3 py-1 text-[11px] sm:text-xs font-medium rounded transition-colors ${
                  currentPage === item.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                <span className="sm:hidden">{item.shortLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        {currentPage === "home" && (
          <div
            className="mt-2 sm:mt-3 relative"
          >
            <div
              className="-ml-2 flex flex-nowrap items-center justify-start gap-x-2 sm:gap-x-3 overflow-x-auto sm:overflow-visible min-w-0 whitespace-nowrap pr-2 sm:pr-28 pb-1 sm:pb-0 scrollbar-none"
              style={{ fontSize: "clamp(11px, 0.75vw, 14px)" }}
            >
              <div className="inline-flex items-center gap-1 rounded-md bg-transparent p-1 shrink-0">
                <button
                  type="button"
                  onClick={onLeftSidebarToggle}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100/70 dark:hover:bg-zinc-700/60 transition-colors shrink-0"
                  aria-label={leftSidebarHidden ? "Show left sidebar" : "Hide left sidebar"}
                  title={leftSidebarHidden ? "Show left sidebar" : "Hide left sidebar"}
                >
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 3.25H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M2 7H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M2 10.75H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
                <span className="text-base font-semibold font-mono text-zinc-900 dark:text-zinc-100 shrink-0">
                  {symbol.toUpperCase()}
                </span>
                <div ref={searchContainerRef} className="relative">
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
                      placeholder="Search"
                      className="w-28 sm:w-44 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                      aria-label="Stock search"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={suggestionsOpen}
                      aria-controls="search-suggestions"
                      aria-activedescendant={
                        highlightedIndex >= 0 ? `suggestion-${highlightedIndex}` : undefined
                      }
                    />
                    <button
                      type="submit"
                      className="rounded bg-zinc-700 dark:bg-zinc-600 text-white px-2 py-1 text-sm hover:bg-zinc-600 dark:hover:bg-zinc-500"
                    >
                      Go
                    </button>
                  </form>
                  {suggestionsOpen && (
                    <ul
                      id="search-suggestions"
                      role="listbox"
                      className="absolute left-0 top-full z-50 mt-1 max-h-60 w-[36rem] max-w-[90vw] overflow-auto rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 py-1 shadow-lg"
                    >
                      {suggestionsLoading ? (
                        <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                          Searching…
                        </li>
                      ) : (
                        suggestions.map((s, i) => (
                          <li
                            key={`${s.symbol}-${i}`}
                            id={`suggestion-${i}`}
                            role="option"
                            aria-selected={i === highlightedIndex}
                            className={`cursor-pointer px-3 py-2 text-sm flex items-center gap-3 ${
                              i === highlightedIndex
                                ? "bg-zinc-100 dark:bg-zinc-700"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                            }`}
                            onMouseEnter={() => setHighlightedIndex(i)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectSymbol(s.symbol);
                            }}
                          >
                            <span className="font-medium font-mono text-zinc-900 dark:text-zinc-100 shrink-0 min-w-[78px]">
                              {s.symbol}
                            </span>
                            {s.name && (
                              <span className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                {s.name}
                              </span>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                Last:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {price != null ? `$${price.toFixed(2)}` : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                Change %:{" "}
                <span
                  className={`tabular-nums ${
                    isUp ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {fmtPct(chgPct)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                Vol:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {vol != null ? vol.toLocaleString() : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                Avg Vol:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {avgVol != null ? avgVol.toLocaleString() : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                Mkt Cap (bn):{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {fmtNum(mktCap)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                52W High:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {yHigh != null ? `$${yHigh.toFixed(2)}` : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                Off 52W High:{" "}
                <span className="tabular-nums text-red-600 dark:text-red-400">
                  {off52WHighPct != null ? `${off52WHighPct.toFixed(2)}%` : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-300">
                ATRP:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {atrPct != null ? `${atrPct.toFixed(2)}%` : "NA"}
                </span>
              </span>
            </div>
            <span className="hidden sm:inline-flex absolute right-0 top-1/2 -translate-y-1/2 items-center gap-1 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-300 whitespace-nowrap pointer-events-none">
              Last Update:{" "}
              <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                {latestDataDate ? formatDisplayDate(latestDataDate) : "NA"}
              </span>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

