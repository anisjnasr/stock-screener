"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Watchlist, Quote } from "@/lib/types";

export function WatchlistWidget() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [addSymbol, setAddSymbol] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api.watchlists.list();
      setWatchlists(Array.isArray(list) ? list : []);
      if (list?.length && !selectedId) setSelectedId(list[0].id);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = watchlists.find((w) => w.id === selectedId);
  const symbols = selected?.watchlist_items?.map((i) => i.symbol) ?? [];

  useEffect(() => {
    if (symbols.length === 0) {
      setQuotes({});
      return;
    }
    let cancelled = false;
    Promise.all(symbols.map((s) => api.quote(s)))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, Quote> = {};
        results.forEach((q) => (map[q.symbol] = q));
        setQuotes(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbols.join(",")]);

  const createWatchlist = async () => {
    setCreating(true);
    setError("");
    try {
      const w = await api.watchlists.create("New Watchlist");
      setWatchlists((prev) => [w, ...prev]);
      setSelectedId(w.id);
    } catch (e) {
      setError((e as Error).message ?? "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const addSymbolToList = async () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym || !selectedId) return;
    setError("");
    try {
      await api.watchlists.addSymbol(selectedId, sym);
      setAddSymbol("");
      load();
    } catch (e) {
      setError((e as Error).message ?? "Failed to add");
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h3 className="mb-3 font-semibold text-white">Watchlist</h3>
        <div className="text-zinc-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-white">Watchlist</h3>
        <button
          type="button"
          onClick={createWatchlist}
          disabled={creating}
          className="rounded bg-emerald-600 px-2 py-1 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {creating ? "…" : "Create"}
        </button>
      </div>
      {watchlists.length > 0 && (
        <>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="mb-2 w-full rounded border border-zinc-600 bg-zinc-700 px-2 py-1.5 text-sm text-white"
          >
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <div className="mb-2 flex gap-1">
            <input
              type="text"
              value={addSymbol}
              onChange={(e) => setAddSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && addSymbolToList()}
              placeholder="Symbol"
              className="flex-1 rounded border border-zinc-600 bg-zinc-700 px-2 py-1 text-sm text-white placeholder-zinc-500"
            />
            <button
              type="button"
              onClick={addSymbolToList}
              className="rounded bg-zinc-700 px-2 py-1 text-sm text-white hover:bg-zinc-600"
            >
              Add
            </button>
          </div>
        </>
      )}
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="space-y-1">
        {symbols.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No symbols. Use search to add, or create a watchlist above.
          </p>
        ) : (
          symbols.map((s) => {
            const q = quotes[s];
            return (
              <Link
                key={s}
                href={`/instruments/${s}`}
                className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-700"
              >
                <span className="font-medium text-white">{s}</span>
                {q ? (
                  <>
                    <span className="text-white">{q.price.toFixed(2)}</span>
                    <span
                      className={
                        q.changePercent >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {q.changePercent >= 0 ? "+" : ""}
                      {q.changePercent.toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
