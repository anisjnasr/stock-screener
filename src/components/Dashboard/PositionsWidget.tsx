"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PositionList, PositionItem, Quote } from "@/lib/types";

export function PositionsWidget() {
  const [lists, setLists] = useState<PositionList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.positions.list();
      setLists(Array.isArray(data) ? data : []);
      if (data?.length && !selectedId) setSelectedId(data[0].id);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = lists.find((l) => l.id === selectedId);
  const items: PositionItem[] = selected?.position_items ?? [];

  useEffect(() => {
    if (items.length === 0) {
      setQuotes({});
      return;
    }
    const symbols = items.map((i) => i.symbol);
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
  }, [items.map((i) => i.symbol).join(",")]);

  const createPositions = async () => {
    setCreating(true);
    try {
      const list = await api.positions.create("Positions");
      setLists((prev) => [list, ...prev]);
      setSelectedId(list.id);
    } catch (e) {
      setError((e as Error).message ?? "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h3 className="mb-3 font-semibold text-white">Positions</h3>
        <div className="text-zinc-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-white">Positions</h3>
        <button
          type="button"
          onClick={createPositions}
          disabled={creating}
          className="rounded bg-emerald-600 px-2 py-1 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {creating ? "…" : "Create list"}
        </button>
      </div>
      {lists.length > 0 && (
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="mb-2 w-full rounded border border-zinc-600 bg-zinc-700 px-2 py-1.5 text-sm text-white"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="space-y-1">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No positions. Create a list and add symbols from instrument pages.
          </p>
        ) : (
          items.map((i) => {
            const q = quotes[i.symbol];
            return (
              <Link
                key={i.id}
                href={`/instruments/${i.symbol}`}
                className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-700"
              >
                <span className="font-medium text-white">
                  {i.symbol}
                  {i.quantity != null && (
                    <span className="ml-1 text-zinc-500">×{i.quantity}</span>
                  )}
                </span>
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
