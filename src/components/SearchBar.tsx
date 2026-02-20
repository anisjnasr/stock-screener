"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SearchResult } from "@/lib/types";

const DEBOUNCE_MS = 300;

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api.search(q.trim());
      setResults(Array.isArray(list) ? list : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, runSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const goToSymbol = (symbol: string) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    router.push(`/instruments/${encodeURIComponent(symbol)}`);
  };

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search symbol (e.g. AAPL)"
        className="w-full rounded-lg border border-zinc-600 bg-zinc-800 py-2 pl-4 pr-10 text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      {open && (query.trim() || results.length > 0) && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-zinc-600 bg-zinc-800 shadow-xl">
          {loading ? (
            <div className="p-4 text-center text-zinc-400">Searching…</div>
          ) : results.length === 0 && query.trim() ? (
            <div className="p-4 text-center text-zinc-400">No results</div>
          ) : (
            results.map((r) => (
              <button
                key={r.symbol}
                type="button"
                className="flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-zinc-700"
                onClick={() => goToSymbol(r.symbol)}
              >
                <span className="font-medium text-white">{r.symbol}</span>
                {r.description && (
                  <span className="truncate text-xs text-zinc-400">
                    {r.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
