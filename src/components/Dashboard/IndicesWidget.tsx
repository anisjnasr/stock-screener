"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Quote } from "@/lib/types";

const INDICES = ["SPY", "QQQ", "DIA", "IWM"];

export function IndicesWidget() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(INDICES.map((s) => api.quote(s)))
      .then((results) => {
        if (!cancelled) setQuotes(results);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h3 className="mb-3 font-semibold text-white">Indices</h3>
        <div className="text-zinc-400">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h3 className="mb-3 font-semibold text-white">Indices</h3>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <h3 className="mb-3 font-semibold text-white">Indices</h3>
      <div className="space-y-2">
        {quotes.map((q) => (
          <Link
            key={q.symbol}
            href={`/instruments/${q.symbol}`}
            className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-700"
          >
            <span className="font-medium text-white">{q.symbol}</span>
            <span className="text-white">{q.price.toFixed(2)}</span>
            <span
              className={
                q.changePercent >= 0 ? "text-emerald-400" : "text-red-400"
              }
            >
              {q.changePercent >= 0 ? "+" : ""}
              {q.changePercent.toFixed(2)}%
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
