"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { type WorkspaceSection, WORKSPACE_SECTIONS } from "@/types/workspace";
import { type StockFlag } from "@/lib/watchlist-storage";

type SearchSuggestion = {
  symbol: string;
  name?: string;
  exchange?: string;
};

const FLAG_COLORS: Record<StockFlag, string> = {
  red: "bg-red-500",
  yellow: "bg-yellow-400",
  green: "bg-emerald-500",
  blue: "bg-blue-500",
};

type WorkspaceHeaderProps = {
  section: WorkspaceSection;
  onSectionChange: (s: WorkspaceSection) => void;
  symbol: string;
  onSymbolChange: (s: string) => void;
  searchValue: string;
  onSearchChange: (s: string) => void;
  onSearchSubmit: () => void;
  flags: Record<string, StockFlag>;
  onFlagFilter?: (flag: StockFlag) => void;
  favoritePills?: { id: string; label: string; onClick: () => void }[];
};

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
  favoritePills = [],
}: WorkspaceHeaderProps) {
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

  // Aggregate flag counts
  const flagCounts = Object.values(flags).reduce<Partial<Record<StockFlag, number>>>(
    (acc, f) => {
      acc[f] = (acc[f] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const visibleFlags = (["red", "yellow", "green", "blue"] as StockFlag[]).filter(
    (f) => (flagCounts[f] ?? 0) > 0
  );

  return (
    <header
      className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b"
      style={{
        background: "var(--ws-bg2)",
        borderColor: "var(--ws-border)",
      }}
    >
      {/* Brand */}
      <img
        src="/brand/stockstalker-lockup.svg"
        alt="Stock Stalker"
        className="h-6 w-auto shrink-0 opacity-80"
      />

      {/* Section pills */}
      <nav className="flex items-center gap-0.5 rounded-md p-0.5 ml-3" style={{ background: "var(--ws-bg)" }}>
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
            <span className="sm:hidden">{s.shortLabel}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* Favorite pills + flag pills */}
      <div className="flex items-center gap-1 ml-2">
        {favoritePills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            onClick={pill.onClick}
            className="px-2 py-0.5 text-[11px] font-medium rounded transition-colors"
            style={{
              background: "var(--ws-bg3)",
              color: "var(--ws-text)",
              border: "1px solid var(--ws-border)",
            }}
          >
            {pill.label}
          </button>
        ))}
        {visibleFlags.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFlagFilter?.(f)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono rounded transition-colors"
            style={{
              background: "var(--ws-bg3)",
              color: "var(--ws-text)",
              border: "1px solid var(--ws-border)",
            }}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${FLAG_COLORS[f]}`} />
            {flagCounts[f]}
          </button>
        ))}
      </div>

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
            style={{
              background: "var(--ws-bg2)",
              border: "1px solid var(--ws-border-hover)",
            }}
          >
            {suggestionsLoading ? (
              <li className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>
                Searching…
              </li>
            ) : (
              suggestions.map((s, i) => (
                <li
                  key={`${s.symbol}-${i}`}
                  id={`ws-suggestion-${i}`}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  className="cursor-pointer px-3 py-1.5 text-xs flex items-center gap-3"
                  style={{
                    background: i === highlightedIndex ? "var(--ws-bg3)" : "transparent",
                  }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSymbol(s.symbol);
                  }}
                >
                  <span className="font-medium font-mono shrink-0 min-w-[60px]" style={{ color: "var(--ws-text)" }}>
                    {s.symbol}
                  </span>
                  {s.name && (
                    <span style={{ color: "var(--ws-text-dim)" }}>{s.name}</span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </header>
  );
}
