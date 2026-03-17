"use client";

import { useState, useMemo } from "react";
import { formatDisplayDate } from "@/lib/date-format";
import { toTitleCase } from "@/lib/text-format";
import NewsSidebar from "@/components/NewsSidebar";

type YearlyRow = {
  year: string;
  eps: number | null;
  epsGrowth: number | null;
  sales: number | null;
  salesGrowth: number | null;
};

type ProfileData = {
  companyName?: string;
  description?: string;
  website?: string;
  exchange?: string;
  country?: string;
  industry?: string;
  sector?: string;
  ipoDate?: string;
  floatShares?: number;
  sharesOutstanding?: number;
} | null;

type RelatedStock = { symbol: string; name: string };

type LeftSidebarProps = {
  symbol: string;
  profile: ProfileData;
  nextEarnings?: string;
  yearly: YearlyRow[];
  relatedStocks?: RelatedStock[];
  onSymbolSelect?: (symbol: string) => void;
  /** Called when the "Related Stocks" section title is clicked; e.g. open watchlists with this list. */
  onOpenRelatedStocksInWatchlist?: () => void;
  /** Open a sector list in Watchlists. */
  onOpenSectorInWatchlist?: (sector: string) => void;
  /** Open an industry list in Watchlists. */
  onOpenIndustryInWatchlist?: (industry: string) => void;
  loading?: boolean;
};

function fmtNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtFloat(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "NA";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString();
}

export default function LeftSidebar({
  symbol,
  profile,
  nextEarnings,
  yearly,
  relatedStocks = [],
  onSymbolSelect,
  onOpenRelatedStocksInWatchlist,
  onOpenSectorInWatchlist,
  onOpenIndustryInWatchlist,
  loading,
}: LeftSidebarProps) {
  const [activeTab, setActiveTab] = useState<"profile" | "news">("profile");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [yearlyExpanded, setYearlyExpanded] = useState(false);

  const uniqueRelatedStocks = useMemo(() => {
    const seen = new Set<string>();
    return relatedStocks.filter(({ symbol }) => {
      const key = symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [relatedStocks]);

  const yearlyVisibleLimit = 5;
  const yearlyRowsToShow = yearlyExpanded ? yearly : yearly.slice(0, yearlyVisibleLimit);
  const hasMoreYears = yearly.length > yearlyVisibleLimit;

  if (loading) {
    return (
      <aside className="w-[22rem] max-w-[22rem] min-w-0 shrink-0 self-stretch min-h-0 border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 flex flex-col">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </aside>
    );
  }

  return (
    <aside className="w-[22rem] max-w-[22rem] min-w-0 shrink-0 self-stretch min-h-0 border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col">
      <div className="px-2 pt-1 pb-1 border-b border-zinc-200 dark:border-zinc-700 shrink-0 min-w-0">
        <div className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              activeTab === "profile"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            Profile
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("news")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              activeTab === "news"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            News
          </button>
        </div>
      </div>
      {activeTab === "profile" ? (
        <>
          <div className="px-2 pt-1 pb-2 border-b border-zinc-200 dark:border-zinc-700 shrink-0 min-w-0">
            {profile?.companyName && (
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2 break-words">
                {profile.companyName}
              </p>
            )}
            <div className="space-y-1.5 text-sm min-w-0">
              {profile?.description && (
                <div className="min-w-0">
                  <p
                    className={`text-zinc-600 dark:text-zinc-400 text-xs break-words ${descriptionExpanded ? "" : "line-clamp-4"}`}
                  >
                    {profile.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded((e) => !e)}
                    className="mt-0.5 text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:underline"
                  >
                    {descriptionExpanded ? "Show less" : "Show more"}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                {profile?.website && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">Website</span>
                    <a
                      href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                      title={profile.website}
                    >
                      {profile.website.replace(/^https?:\/\//, "")}
                    </a>
                  </>
                )}
                {profile?.exchange != null && profile.exchange !== "" && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">Exchange</span>
                    <span className="text-zinc-900 dark:text-zinc-100">{profile.exchange}</span>
                  </>
                )}
                <>
                  <span className="text-zinc-500 dark:text-zinc-400">Sector</span>
                  {profile?.sector && profile.sector.trim() !== "" ? (
                    onOpenSectorInWatchlist ? (
                      <button
                        type="button"
                        onClick={() => onOpenSectorInWatchlist(profile.sector as string)}
                        className="text-left text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:underline"
                        title={`Open ${profile.sector} in Watchlists`}
                      >
                        {profile.sector}
                      </button>
                    ) : (
                      <span className="text-zinc-900 dark:text-zinc-100">{profile.sector}</span>
                    )
                  ) : (
                    <span className="text-zinc-900 dark:text-zinc-100">NA</span>
                  )}
                </>
                {profile?.industry != null && profile.industry !== "" && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">Industry</span>
                    {onOpenIndustryInWatchlist ? (
                      <button
                        type="button"
                        onClick={() => onOpenIndustryInWatchlist(profile.industry as string)}
                        className="text-left text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:underline"
                        title={`Open ${profile.industry} in Watchlists`}
                      >
                        {toTitleCase(profile.industry)}
                      </button>
                    ) : (
                      <span className="text-zinc-900 dark:text-zinc-100">{toTitleCase(profile.industry)}</span>
                    )}
                  </>
                )}
                {profile?.country != null && profile.country !== "" && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">Country</span>
                    <span className="text-zinc-900 dark:text-zinc-100">{profile.country}</span>
                  </>
                )}
                {profile?.ipoDate != null && profile.ipoDate !== "" && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">IPO date</span>
                    <span className="text-zinc-900 dark:text-zinc-100">{formatDisplayDate(profile.ipoDate)}</span>
                  </>
                )}
                {profile?.floatShares != null && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">Free float</span>
                    <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                      {fmtFloat(profile.floatShares)}
                    </span>
                  </>
                )}
                <>
                  <span className="text-zinc-500 dark:text-zinc-400">Next earnings</span>
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {nextEarnings ? formatDisplayDate(nextEarnings) : "NA"}
                  </span>
                </>
              </div>
            </div>
          </div>
          <div className="shrink-0 overflow-x-auto overflow-y-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="py-1.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-left">Year</th>
                  <th className="py-1.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-right">EPS</th>
                  <th className="py-1.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-right">EPS %</th>
                  <th className="py-1.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-right">Sales</th>
                  <th className="py-1.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-right">Sales %</th>
                </tr>
              </thead>
              <tbody>
                {yearlyRowsToShow.map((row) => (
                  <tr
                    key={row.year}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1 px-2 text-zinc-900 dark:text-zinc-100 text-left">
                      {row.year}
                    </td>
                    <td className="py-1 px-2 tabular-nums text-zinc-900 dark:text-zinc-100 text-right">
                      {row.eps != null ? row.eps.toFixed(2) : "NA"}
                    </td>
                    <td className={`py-1 px-2 tabular-nums text-right ${row.epsGrowth != null ? (row.epsGrowth >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-zinc-600 dark:text-zinc-400"}`}>
                      {row.epsGrowth != null ? fmtPct(row.epsGrowth) : "NA"}
                    </td>
                    <td className="py-1 px-2 tabular-nums text-zinc-900 dark:text-zinc-100 text-right">
                      {row.sales != null ? fmtNum(row.sales) : "NA"}
                    </td>
                    <td className={`py-1 px-2 tabular-nums text-right ${row.salesGrowth != null ? (row.salesGrowth >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-zinc-600 dark:text-zinc-400"}`}>
                      {row.salesGrowth != null ? fmtPct(row.salesGrowth) : "NA"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMoreYears && (
              <div className="px-2 py-1 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setYearlyExpanded((e) => !e)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:underline"
                >
                  {yearlyExpanded ? "Show less" : "Show more"}
                </button>
              </div>
            )}
          </div>
          <div className="p-2 min-h-0 flex-1 flex flex-col border-t border-zinc-200 dark:border-zinc-700">
            <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1 shrink-0">
              {onOpenRelatedStocksInWatchlist ? (
                <button
                  type="button"
                  onClick={onOpenRelatedStocksInWatchlist}
                  className="text-left hover:text-zinc-700 dark:hover:text-zinc-300 focus:outline-none focus:underline underline-offset-1"
                >
                  Related Stocks
                </button>
              ) : (
                "Related Stocks"
              )}
            </h2>
            {uniqueRelatedStocks.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">—</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
                <ul className="space-y-1 text-xs min-w-0 pr-1">
                  {uniqueRelatedStocks.map(({ symbol: sym, name }) => (
                    <li key={sym} className="flex items-baseline gap-2 min-w-0">
                      <span className="shrink-0 w-14 text-left">
                        {onSymbolSelect ? (
                          <button
                            type="button"
                            onClick={() => onSymbolSelect(sym)}
                            className="font-semibold font-mono text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:underline text-left"
                          >
                            {sym}
                          </button>
                        ) : (
                          <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-100">{sym}</span>
                        )}
                      </span>
                      <span className="text-zinc-600 dark:text-zinc-400 truncate text-left min-w-0" title={name}>
                        {name || "NA"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <NewsSidebar symbol={symbol} embedded />
        </div>
      )}
    </aside>
  );
}
