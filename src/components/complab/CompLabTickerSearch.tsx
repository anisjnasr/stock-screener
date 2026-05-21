"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Suggestion = { symbol: string; name?: string };

type Props = {
  autoFocus?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (symbol: string) => void;
  placeholder?: string;
  showSearchIcon?: boolean;
  resetAfterSubmit?: boolean;
  className?: string;
  inputClassName?: string;
};

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
      style={{ color: "var(--ws-text-dim)" }}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function CompLabTickerSearch({
  autoFocus = false,
  disabled = false,
  loading = false,
  onSubmit,
  placeholder = "Ticker",
  showSearchIcon = false,
  resetAfterSubmit = false,
  className = "",
  inputClassName = "",
}: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    const t = window.setTimeout(() => {
      setSuggestionsLoading(true);
      fetch(`/api/search-symbol?query=${encodeURIComponent(query.trim())}`)
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
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const submitSymbol = useCallback(
    (raw: string) => {
      const sym = normalizeTicker(raw);
      if (!sym || disabled || loading) return;
      onSubmit(sym);
      setSuggestionsOpen(false);
      setSuggestions([]);
      setHighlightedIndex(-1);
      if (resetAfterSubmit) {
        setQuery("");
      }
    },
    [disabled, loading, onSubmit, resetAfterSubmit]
  );

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (suggestionsOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          submitSymbol(suggestions[highlightedIndex].symbol);
          return;
        }
        submitSymbol(query);
      }}
    >
      <div ref={containerRef} className="relative w-full">
        {showSearchIcon && <SearchIcon />}
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled || loading}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onFocus={() => {
            if (query.trim() && suggestions.length > 0) setSuggestionsOpen(true);
          }}
          onKeyDown={(e) => {
            if (!suggestionsOpen || suggestions.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
            } else if (e.key === "Enter" && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
              e.preventDefault();
              submitSymbol(suggestions[highlightedIndex].symbol);
            } else if (e.key === "Escape") {
              setSuggestionsOpen(false);
            }
          }}
          placeholder={placeholder}
          aria-label="Stock ticker search"
          autoComplete="off"
          className={`w-full rounded py-1.5 text-sm leading-tight ${showSearchIcon ? "pl-6 pr-2" : "px-3 py-2"} ${inputClassName}`}
          style={{
            background: "var(--ws-bg3)",
            color: "var(--ws-text)",
            border: "1px solid var(--ws-border)",
          }}
        />
        {suggestionsOpen && (
          <ul
            className="absolute left-0 top-full z-[120] mt-1 max-h-[50vh] w-max min-w-full max-w-[min(92vw,42rem)] overflow-auto rounded py-1 shadow-lg"
            style={{ background: "var(--ws-bg2)", border: "1px solid var(--ws-border-hover)" }}
            role="listbox"
          >
            {suggestionsLoading ? (
              <li className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>
                Searching…
              </li>
            ) : suggestions.length === 0 ? (
              <li className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>
                No matches
              </li>
            ) : (
              suggestions.map((s, i) => (
                <li
                  key={`${s.symbol}-${i}`}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  className="cursor-pointer px-3 py-1.5 text-xs flex items-center gap-3 whitespace-nowrap"
                  style={{ background: i === highlightedIndex ? "var(--ws-bg3)" : "transparent" }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    submitSymbol(s.symbol);
                  }}
                >
                  <span className="font-medium font-mono shrink-0 min-w-[60px]" style={{ color: "var(--ws-text)" }}>
                    {s.symbol}
                  </span>
                  {s.name && (
                    <span className="whitespace-nowrap" style={{ color: "var(--ws-text-dim)" }}>
                      {s.name}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </form>
  );
}
