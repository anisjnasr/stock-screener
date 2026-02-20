"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { Watchlist } from "@/lib/types";

export function AddToWatchlist({ symbol }: { symbol: string }) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    api.watchlists.list().then((list) => setWatchlists(Array.isArray(list) ? list : []));
  }, []);

  const addTo = async (watchlistId: string) => {
    setAdding(watchlistId);
    try {
      await api.watchlists.addSymbol(watchlistId, symbol);
      setOpen(false);
    } finally {
      setAdding(null);
    }
  };

  if (watchlists.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
      >
        Add to watchlist
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded border border-zinc-600 bg-zinc-800 py-1 shadow-xl">
          {watchlists.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => addTo(w.id)}
              disabled={adding !== null}
              className="block w-full px-3 py-1.5 text-left text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {adding === w.id ? "Adding…" : w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
