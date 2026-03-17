"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
  dbUpdateCompletedAt?: Date | null;
  leftSidebarHidden?: boolean;
  onLeftSidebarToggle?: () => void;
};

function ordinal(day: number): string {
  const rem10 = day % 10;
  const rem100 = day % 100;
  if (rem10 === 1 && rem100 !== 11) return `${day}st`;
  if (rem10 === 2 && rem100 !== 12) return `${day}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${day}rd`;
  return `${day}th`;
}

function formatDbUpdateTimestamp(input: Date | null | undefined): string {
  if (!input || Number.isNaN(input.getTime())) return "NA";
  const d = input;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = ordinal(d.getDate());
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const h24 = d.getHours();
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = h24 < 12 ? "am" : "pm";
  return `${day} ${month} ${year} ${hour12}:${minutes}${ampm}`;
}

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
  dbUpdateCompletedAt,
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

  return (
    <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shadow-sm">
      <div className="relative px-4 py-3">
        <img
          src="/brand/stockstalker-lockup.svg"
          alt={brandName}
          className="h-8 w-auto rounded border border-zinc-200 dark:border-zinc-700 absolute right-4 top-3"
        />
        <div className="flex items-center justify-center pr-28">
          <div className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 p-1">
            {[
              { id: "home" as HeaderPage, label: "Home" },
              { id: "market-monitor" as HeaderPage, label: "Market Monitor" },
              { id: "market-breadth" as HeaderPage, label: "Sectors / Industries" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange?.(item.id)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
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
              className="ml-1 flex items-center justify-center text-zinc-500 dark:text-zinc-300 hover:text-zinc-700 dark:hover:text-zinc-100"
              style={{ width: 28, height: 28 }}
              title="Add page"
              aria-label="Add page"
            >
              <span className="text-base leading-none">+</span>
            </button>
          </div>
        </div>
        {currentPage === "home" && (
          <div
            className="mt-3 pr-28 relative"
          >
            <div
              className="-ml-2 flex flex-nowrap items-center justify-start gap-x-2 sm:gap-x-3 overflow-x-auto min-w-0 whitespace-nowrap"
              style={{ fontSize: "clamp(11px, 0.75vw, 14px)" }}
            >
              <div className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 p-1 shrink-0">
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
                        if (suggestions.length > 0) setSuggestionsOpen(true);
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder="Search"
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
              </div>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                Last:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {price != null ? `$${price.toFixed(2)}` : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                Change %:{" "}
                <span
                  className={`tabular-nums ${
                    isUp ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {fmtPct(chgPct)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                Vol:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {vol != null ? vol.toLocaleString() : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                Avg Vol:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {avgVol != null ? avgVol.toLocaleString() : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                Mkt Cap (bn):{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {fmtNum(mktCap)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                52W High:{" "}
                <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {yHigh != null ? `$${yHigh.toFixed(2)}` : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                Off 52W High:{" "}
                <span className="tabular-nums text-red-600 dark:text-red-400">
                  {off52WHighPct != null ? `${off52WHighPct.toFixed(2)}%` : "NA"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 shrink-0 text-zinc-600 dark:text-zinc-400">
                ATRP:{" "}
                <span className="tabular-nums text-blue-600 dark:text-blue-400">
                  {atrPct != null ? `${atrPct.toFixed(2)}%` : "NA"}
                </span>
              </span>
            </div>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap pointer-events-none">
              DB Update:{" "}
              <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                {formatDbUpdateTimestamp(dbUpdateCompletedAt)}
              </span>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

