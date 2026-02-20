"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { NewsItem } from "@/lib/types";

export function NewsWidget() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .news()
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
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
        <h3 className="mb-3 font-semibold text-white">Market News</h3>
        <div className="text-zinc-400">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h3 className="mb-3 font-semibold text-white">Market News</h3>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <h3 className="mb-3 font-semibold text-white">Market News</h3>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {items.slice(0, 10).map((n) => (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded px-2 py-1.5 text-sm hover:bg-zinc-700"
          >
            <span className="text-zinc-200 line-clamp-2">{n.headline}</span>
            {n.source && (
              <span className="mt-0.5 block text-xs text-zinc-500">
                {n.source}
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
