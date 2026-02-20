"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { InstrumentChart } from "./InstrumentChart";
import { AddToWatchlist } from "./AddToWatchlist";
import type {
  CompanyProfile,
  Quote,
  Fundamentals,
  NewsItem,
  ShortStats,
  InstitutionalStats,
} from "@/lib/types";

export function InstrumentOverview({ symbol }: { symbol: string }) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [shortStats, setShortStats] = useState<ShortStats | null>(null);
  const [instStats, setInstStats] = useState<InstitutionalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.profile(symbol),
      api.quote(symbol),
      api.fundamentals(symbol),
      api.news(symbol),
      api.short(symbol),
      api.institutional(symbol),
    ])
      .then(([p, q, f, n, s, i]) => {
        if (cancelled) return;
        setProfile(p as CompanyProfile);
        setQuote(q as Quote);
        setFundamentals(f as Fundamentals);
        setNews(Array.isArray(n) ? n : []);
        setShortStats(s as ShortStats);
        setInstStats(i as InstitutionalStats);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message ?? "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-zinc-400">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-900/10 p-4 text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <AddToWatchlist symbol={symbol} />
      </div>
      {/* Profile */}
      <section className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Profile</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-zinc-500">Name</span>
            <p className="text-white">{profile?.name ?? "—"}</p>
          </div>
          {profile?.website && (
            <div>
              <span className="text-zinc-500">Website</span>
              <p>
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:underline"
                >
                  {profile.website}
                </a>
              </p>
            </div>
          )}
          {profile?.employees != null && (
            <div>
              <span className="text-zinc-500">Employees</span>
              <p className="text-white">{profile.employees.toLocaleString()}</p>
            </div>
          )}
          {profile?.address && (
            <div className="sm:col-span-2">
              <span className="text-zinc-500">Address</span>
              <p className="text-white">{profile.address}</p>
            </div>
          )}
          {profile?.industry && (
            <div>
              <span className="text-zinc-500">Industry</span>
              <p className="text-white">{profile.industry}</p>
            </div>
          )}
        </div>
      </section>

      {/* Overview: price, market cap, float, earnings */}
      <section className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Overview</h2>
        <div className="flex flex-wrap items-baseline gap-4">
          {quote && (
            <>
              <span className="text-2xl font-bold text-white">
                ${quote.price.toFixed(2)}
              </span>
              <span
                className={
                  quote.changePercent >= 0 ? "text-emerald-400" : "text-red-400"
                }
              >
                {quote.changePercent >= 0 ? "+" : ""}
                {quote.changePercent.toFixed(2)}% ({quote.change >= 0 ? "+" : ""}
                {quote.change.toFixed(2)})
              </span>
            </>
          )}
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {fundamentals?.marketCap != null && (
            <div>
              <span className="text-zinc-500">Market cap</span>
              <p className="text-white">
                ${(fundamentals.marketCap / 1e9).toFixed(2)}B
              </p>
            </div>
          )}
          {fundamentals?.float != null && (
            <div>
              <span className="text-zinc-500">Float</span>
              <p className="text-white">
                {(fundamentals.float / 1e6).toFixed(2)}M
              </p>
            </div>
          )}
          {fundamentals?.nextEarningsDate && (
            <div>
              <span className="text-zinc-500">Next earnings</span>
              <p className="text-white">{fundamentals.nextEarningsDate}</p>
            </div>
          )}
          {fundamentals?.pe != null && (
            <div>
              <span className="text-zinc-500">P/E</span>
              <p className="text-white">{fundamentals.pe.toFixed(1)}</p>
            </div>
          )}
        </div>
      </section>

      {/* Chart */}
      <section className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Chart</h2>
        <InstrumentChart symbol={symbol} />
      </section>

      {/* Short statistics */}
      <section className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">
          Short statistics
        </h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-zinc-500">Short % of float</span>
            <p className="text-white">
              {shortStats?.shortPercentFloat != null
                ? `${shortStats.shortPercentFloat.toFixed(2)}%`
                : "N/A"}
            </p>
          </div>
          <div>
            <span className="text-zinc-500">Days to cover</span>
            <p className="text-white">
              {shortStats?.daysToCover != null
                ? shortStats.daysToCover.toFixed(1)
                : "N/A"}
            </p>
          </div>
          {shortStats?.note && (
            <p className="sm:col-span-2 text-xs text-zinc-500">
              {shortStats.note}
            </p>
          )}
        </div>
      </section>

      {/* Institutional */}
      <section className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">
          Institutional ownership
        </h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-zinc-500">Ownership %</span>
            <p className="text-white">
              {instStats?.ownershipPercent != null
                ? `${instStats.ownershipPercent.toFixed(1)}%`
                : "N/A"}
            </p>
          </div>
          <div>
            <span className="text-zinc-500">Number of funds</span>
            <p className="text-white">
              {instStats?.numberOfFunds ?? "N/A"}
            </p>
          </div>
          {instStats?.trend && (
            <div>
              <span className="text-zinc-500">QoQ trend</span>
              <p className="text-white">{instStats.trend}</p>
            </div>
          )}
          {instStats?.note && (
            <p className="sm:col-span-2 text-xs text-zinc-500">
              {instStats.note}
            </p>
          )}
        </div>
      </section>

      {/* News */}
      <section className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">News</h2>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {news.length === 0 ? (
            <p className="text-zinc-500">No recent news.</p>
          ) : (
            news.slice(0, 15).map((n) => (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded px-2 py-1.5 hover:bg-zinc-700"
              >
                <span className="text-zinc-200">{n.headline}</span>
                {n.source && (
                  <span className="ml-2 text-xs text-zinc-500">{n.source}</span>
                )}
              </a>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
