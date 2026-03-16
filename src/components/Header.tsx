"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatDisplayDateTime } from "@/lib/date-format";

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

export type HeaderPage = "home" | "market-monitor" | "market-breadth";

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
}: HeaderProps) {
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
          setSuggestionsOpen(
            list.length > 0 && searchValue.trim().toUpperCase() !== symbol.toUpperCase()
          );
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
      onSearchChange(sym);
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

  return (
    <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate min-w-0">
              {currentPage === "home" ? (loading ? "…" : name) : "Stock Scanner"}
            </h1>
            {currentPage === "home" && (
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
                    if (suggestions.length > 0) setSuggestionsOpen(true);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Search..."
                  className="w-28 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
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
                  className="absolute left-0 top-full z-50 mt-1 max-h-60 w-72 overflow-auto rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 py-1 shadow-lg"
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
                        className={`cursor-pointer px-3 py-2 text-sm ${
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
                        <span className="font-medium font-mono text-zinc-900 dark:text-zinc-100">
                          {s.symbol}
                        </span>
                        {s.name && (
                          <span className="ml-2 text-zinc-500 dark:text-zinc-400 truncate block">
                            {s.name}
                          </span>
                        )}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            )}
          </div>
          {/* Center nav: primary pages */}
          <div className="flex-1 flex items-center justify-center">
            <div className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-1">
              {[
                { id: "home" as HeaderPage, label: "Home" },
                { id: "market-monitor" as HeaderPage, label: "Market Monitor" },
                { id: "market-breadth" as HeaderPage, label: "Sectors / Industries" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPageChange?.(item.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    currentPage === item.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  /* reserved for future: open add-page dialog */
                }}
                className="ml-1 flex items-center justify-center rounded-full border border-dashed border-zinc-400 text-zinc-500 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                style={{ width: 28, height: 28 }}
                title="Add page"
                aria-label="Add page"
              >
                <span className="text-base leading-none">+</span>
              </button>
            </div>
          </div>
          {currentPage === "home" && (
          <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-1 text-sm overflow-x-auto min-w-0">
            <span className="text-zinc-600 dark:text-zinc-400">
              Last:{" "}
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {price != null ? `$${price.toFixed(2)}` : "NA"}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              Change %:{" "}
              <span
                className={`tabular-nums ${
                  isUp ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                }`}
              >
                {fmtPct(chgPct)}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              Vol:{" "}
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {vol != null ? vol.toLocaleString() : "NA"}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              Avg Vol:{" "}
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {avgVol != null ? avgVol.toLocaleString() : "NA"}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              Mkt Cap (bn):{" "}
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {fmtNum(mktCap)}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              52W High:{" "}
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {yHigh != null ? `$${yHigh.toFixed(2)}` : "NA"}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              Off 52W High:{" "}
              <span className="tabular-nums text-red-600 dark:text-red-400">
                {off52WHighPct != null ? `${off52WHighPct.toFixed(2)}%` : "NA"}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              ATRP:{" "}
              <span className="tabular-nums text-blue-600 dark:text-blue-400">
                {atrPct != null ? `${atrPct.toFixed(2)}%` : "NA"}
              </span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              Updated:{" "}
              <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {lastUpdate != null ? formatDisplayDateTime(lastUpdate) : "NA"}
              </span>
            </span>
          </div>
          )}
        </div>
      </div>
    </header>
  );
}

