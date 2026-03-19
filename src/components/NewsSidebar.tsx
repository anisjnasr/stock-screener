"use client";

import { useEffect, useState } from "react";
import { formatDisplayDateTime } from "@/lib/date-format";

type NewsItem = {
  title: string;
  publishedDate: string;
  publishedUtc?: string;
  url: string;
  text?: string;
  tickers?: string[];
  source?: string;
};

type NewsSidebarProps = {
  symbol: string;
};

function formatNewsTime(utc?: string): string {
  if (!utc) return "";
  try {
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return utc.slice(0, 10);
    return formatDisplayDateTime(d);
  } catch {
    return utc.slice(0, 10);
  }
}

export default function NewsSidebar({ symbol }: NewsSidebarProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setNews([]);
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}&limit=15`)
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        const sym = symbol.toUpperCase();
        const filtered = list.filter(
          (item: NewsItem) =>
            !item.tickers?.length || item.tickers.map((t) => String(t).toUpperCase()).includes(sym)
        );
        setNews(filtered);
      })
      .catch(() => setNews([]))
      .finally(() => setLoading(false));
  }, [symbol]);

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
      <div className="p-2 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {symbol ? (
            <>NEWS (<span className="font-mono">{symbol.toUpperCase()}</span>)</>
          ) : (
            "NEWS"
          )}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        ) : news.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No news</p>
        ) : (
          <ul className="space-y-2">
            {news.map((item, i) => (
              <li key={i}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-900 dark:text-zinc-100 hover:underline line-clamp-2"
                >
                  {item.title}
                </a>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 space-x-1.5">
                  {item.source && <span>{item.source}</span>}
                  {(item.source && (item.publishedUtc || item.publishedDate)) && <span>·</span>}
                  {(item.publishedUtc || item.publishedDate) && (
                    <span>{formatNewsTime(item.publishedUtc || item.publishedDate)}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
