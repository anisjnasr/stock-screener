"use client";

import { useState } from "react";
import { type WorkspaceSection } from "@/types/workspace";
import NewsSidebar from "@/components/NewsSidebar";
import { toTitleCase } from "@/lib/text-format";

type YearlyRow = {
  year: string;
  eps: number | null;
  epsGrowth: number | null;
  sales: number | null;
  salesGrowth: number | null;
};

type QuarterlyRow = {
  period: string;
  eps: number | null;
  epsGrowth: number | null;
  sales: number | null;
  salesGrowth: number | null;
};

type OwnershipQuarter = {
  report_date: string;
  num_funds: number | null;
  num_funds_change: number | null;
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
  mktCap?: number;
} | null;

type RsRank = {
  rs_pct_1w: number | null;
  rs_pct_1m: number | null;
  rs_pct_3m: number | null;
  rs_pct_6m: number | null;
  rs_pct_12m: number | null;
} | null;

type IndustryRanks = {
  industry_rank_1m: number | null;
  industry_rank_3m: number | null;
  industry_rank_6m: number | null;
  industry_rank_12m: number | null;
} | null;

type IndustryRankUniverse = {
  industry_rank_1m: number;
  industry_rank_3m: number;
  industry_rank_6m: number;
  industry_rank_12m: number;
} | null;

type DbProfileMetrics = {
  marketCap: number | null;
  avgVolume20d: number | null;
  atrPct21d: number | null;
} | null;

type RightRailProps = {
  section: WorkspaceSection;
  symbol: string;
  profile: ProfileData;
  nextEarnings?: string;
  yearlyRows: YearlyRow[];
  quarterlyRows: QuarterlyRow[];
  ownershipQuarters: OwnershipQuarter[];
  fundCount?: number;
  rsRank?: RsRank;
  industryRanks?: IndustryRanks;
  industryRankUniverse?: IndustryRankUniverse;
  dbProfileMetrics?: DbProfileMetrics;
  loading?: boolean;
};

type RailTab = "profile" | "news";

function fmtMarketCapNoDollar(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)} tn`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} bn`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return n.toFixed(0);
}

/** Revenue column in fundamentals table: compact scale with two decimal places. */
function fmtRevenueTwoDecimals(n: number): string {
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

function exchangeFriendlyName(code: string | undefined): string {
  if (code == null || !String(code).trim()) return "—";
  const upper = String(code).trim().toUpperCase();
  const map: Record<string, string> = {
    XNAS: "Nasdaq",
    XNYS: "NYSE",
    XASE: "NYSE American (AMEX)",
    ARCX: "NYSE Arca",
    BATS: "Cboe BZX",
    XNCM: "Nasdaq Capital",
    XNGS: "Nasdaq Global Select",
    XNMS: "Nasdaq Global",
  };
  return map[upper] ?? String(code).trim();
}

function fmtPctSigned(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}

function fmtPeriodShort(period: string): string {
  const qMatch = period.match(/^Q(\d)\s*(\d{4})$/);
  if (qMatch) return `Q${qMatch[1]} '${qMatch[2].slice(2)}`;
  const qdMatch = period.match(/Quarter\s*(\d)\s*(\d{4})/i);
  if (qdMatch) return `Q${qdMatch[1]} '${qdMatch[2].slice(2)}`;
  if (/^\d{4}$/.test(period)) return period;
  return period;
}

function fmtDateToQuarter(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return dateStr;
  const m = d.getUTCMonth();
  const q = m < 3 ? 1 : m < 6 ? 2 : m < 9 ? 3 : 4;
  return `Q${q} '${String(d.getUTCFullYear()).slice(2)}`;
}

export default function RightRail({
  symbol,
  profile,
  nextEarnings,
  yearlyRows,
  quarterlyRows,
  ownershipQuarters,
  rsRank,
  industryRanks,
  industryRankUniverse,
  dbProfileMetrics,
  loading,
}: RightRailProps) {
  const [railTab, setRailTab] = useState<RailTab>("profile");
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [finFreq, setFinFreq] = useState<"annual" | "quarterly">("annual");

  if (loading) {
    return (
      <div className="h-full p-3 flex items-start" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-sm" style={{ color: "var(--ws-text-dim)" }}>Loading…</span>
      </div>
    );
  }

  const safe = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  };


  const desc = safe(profile?.description);
  const truncatedDesc = desc.length > 150 ? desc.slice(0, 150) + "…" : desc;

  const capValue = dbProfileMetrics?.marketCap ?? null;
  const marketCapLabel =
    capValue != null && Number.isFinite(capValue) && capValue > 0 ? fmtMarketCapNoDollar(capValue) : "—";
  const avgVol20dLabel =
    dbProfileMetrics?.avgVolume20d != null && Number.isFinite(dbProfileMetrics.avgVolume20d)
      ? Math.round(dbProfileMetrics.avgVolume20d).toLocaleString("en-US")
      : "—";
  const atrPctLabel =
    dbProfileMetrics?.atrPct21d != null && Number.isFinite(dbProfileMetrics.atrPct21d)
      ? `${dbProfileMetrics.atrPct21d.toFixed(2)}%`
      : "—";

  const sectionDivider = <div style={{ height: 1, background: "var(--ws-border)", margin: "4px -12px" }} />;
  const getIndustryRankColor = (rank: number | null, totalIndustries: number | null | undefined): string => {
    if (rank == null) return "var(--ws-text-vdim)";
    if (rank <= 20) return "var(--ws-green)";
    if (totalIndustries != null && Number.isFinite(totalIndustries) && rank > totalIndustries - 20) {
      return "var(--ws-red)";
    }
    return "var(--ws-text)";
  };

  const tabLabels: Record<RailTab, string> = { profile: "Profile", news: "News" };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" style={{ background: "var(--ws-bg2)" }}>
      {/* Tab row at the very top */}
      <div className="flex items-center gap-1 px-3 py-1" role="tablist" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        {(["profile", "news"] as RailTab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => setRailTab(tab)}
            role="tab"
            aria-selected={railTab === tab}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ws-focus-ring ${railTab !== tab ? "hover:bg-white/[0.06]" : ""}`}
            style={{
              background: railTab === tab ? "var(--ws-bg3)" : undefined,
              color: railTab === tab ? "var(--ws-text)" : "var(--ws-text-dim)",
            }}>
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {railTab === "news" ? (
        <>
          {/* Ticker + Name header for News tab */}
          <div className="px-3 py-1.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-bold leading-tight tracking-tight" style={{ color: "var(--ws-text)" }}>
                {symbol}
              </span>
              {profile?.companyName && (
                <span className="text-sm font-semibold leading-snug truncate min-w-0" style={{ color: "rgba(201,209,217,0.85)" }}>
                  {safe(profile.companyName)}
                </span>
              )}
            </div>
          </div>
          <NewsSidebar symbol={symbol} />
        </>
      ) : (
        <>
          {/* Profile header */}
          <div className="px-3 py-1.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-bold leading-tight tracking-tight" style={{ color: "var(--ws-text)" }}>
                {symbol}
              </span>
              {profile?.companyName && (
                <span className="text-sm font-semibold leading-snug truncate min-w-0" style={{ color: "rgba(201,209,217,0.85)" }}>
                  {safe(profile.companyName)}
                </span>
              )}
            </div>
            {profile?.website && typeof profile.website === "string" && (
              <a href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
                target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-sm font-medium" style={{ color: "var(--ws-cyan)" }}>
                {safe(profile.website).replace(/^https?:\/\//, "")}
              </a>
            )}

            {desc && (
              <div className="mt-2">
                <p className="text-sm leading-relaxed" style={{ color: "rgba(201,209,217,0.8)" }}>
                  {showFullDesc ? desc : truncatedDesc}
                </p>
                {desc.length > 150 && (
                  <button type="button" onClick={() => setShowFullDesc((v) => !v)} className="text-ws-body mt-0.5" style={{ color: "var(--ws-cyan)" }}>
                    {showFullDesc ? "Less" : "More"}
                  </button>
                )}
              </div>
            )}

            <div
              className="mt-2 grid gap-x-2 gap-y-1.5 text-xs items-center"
              style={{ gridTemplateColumns: "minmax(4.5rem, auto) 1fr" }}
            >
              <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>Exchange</span>
              <span className="font-medium tabular-nums" style={{ color: "var(--ws-text)" }}>{safe(exchangeFriendlyName(profile?.exchange))}</span>

              <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>Sector</span>
              <span className="font-medium truncate min-w-0" style={{ color: "var(--ws-text)" }}>
                {profile?.sector ? safe(profile.sector) : "—"}
              </span>

              <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>Industry</span>
              <span className="font-medium truncate min-w-0" style={{ color: "var(--ws-text)" }}>
                {profile?.industry ? toTitleCase(safe(profile.industry)) : "—"}
              </span>

              <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>Market Cap</span>
              <span className="font-medium font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>{marketCapLabel}</span>

              <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>Avg Vol (20D)</span>
              <span className="font-medium font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>{avgVol20dLabel}</span>

              <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>ATR %</span>
              <span className="font-medium font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>{atrPctLabel}</span>
            </div>
          </div>

          <div className="px-3 py-2 space-y-2.5">

          {/* RS RANK */}
          {rsRank && (
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ws-text)" }}>
                RS Rank
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    {["1W", "1M", "3M", "6M", "12M"].map((p) => (
                      <th key={p} className="py-1 font-medium text-center" style={{ color: "var(--ws-text)" }}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {[rsRank.rs_pct_1w, rsRank.rs_pct_1m, rsRank.rs_pct_3m, rsRank.rs_pct_6m, rsRank.rs_pct_12m].map((v, i) => (
                      <td key={i} className="py-1.5 text-center font-mono font-semibold tabular-nums"
                        style={{ color: v != null ? (v >= 80 ? "var(--ws-green)" : v <= 30 ? "var(--ws-red)" : "var(--ws-text)") : "var(--ws-text-vdim)" }}>
                        {v != null ? v.toFixed(0) : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {industryRanks && (
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ws-text)" }}>
                Industry Leaderboard Rank (1 = best)
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    {["1M", "3M", "6M", "12M"].map((p) => (
                      <th key={p} className="py-1 font-medium text-center" style={{ color: "var(--ws-text)" }}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {[
                      { rank: industryRanks.industry_rank_1m, total: industryRankUniverse?.industry_rank_1m ?? null },
                      { rank: industryRanks.industry_rank_3m, total: industryRankUniverse?.industry_rank_3m ?? null },
                      { rank: industryRanks.industry_rank_6m, total: industryRankUniverse?.industry_rank_6m ?? null },
                      { rank: industryRanks.industry_rank_12m, total: industryRankUniverse?.industry_rank_12m ?? null },
                    ].map((item, i) => (
                      <td key={i} className="py-1.5 text-center font-mono font-semibold tabular-nums" style={{ color: getIndustryRankColor(item.rank, item.total) }}>
                        {item.rank != null ? String(Math.round(item.rank)) : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {(rsRank || industryRanks) && sectionDivider}

          {/* REVENUE & EPS — combined table */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold" style={{ color: "var(--ws-text)" }}>Revenue &amp; EPS</span>
              <div className="flex items-center gap-0.5">
                {(["annual", "quarterly"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setFinFreq(v)}
                    aria-pressed={finFreq === v}
                    className={`px-2 py-0.5 text-xs rounded transition-colors capitalize ws-focus-ring ${finFreq !== v ? "hover:bg-white/[0.06]" : ""}`}
                    style={{ background: finFreq === v ? "var(--ws-bg3)" : undefined, color: "var(--ws-text)" }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            {nextEarnings && (
              <div className="text-ws-body mb-1.5" style={{ color: "var(--ws-text)" }}>
                Next earnings: <span style={{ color: "var(--ws-text)" }}>{safe(nextEarnings)}</span>
              </div>
            )}
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <th className="py-1 text-left font-medium" style={{ color: "var(--ws-text)" }}>Period</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text)" }}>Rev</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text)" }}>Rev %</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text)" }}>EPS</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text)" }}>EPS %</th>
                </tr>
              </thead>
              <tbody>
                {(finFreq === "annual"
                  ? yearlyRows.slice(0, 8).map((r) => ({
                      period: fmtPeriodShort(r.year),
                      revenue: r.sales,
                      revGrowth: r.salesGrowth,
                      eps: r.eps,
                      epsGrowth: r.epsGrowth,
                    }))
                  : quarterlyRows.slice(0, 8).map((r) => ({
                      period: fmtPeriodShort(r.period),
                      revenue: r.sales,
                      revGrowth: r.salesGrowth,
                      eps: r.eps,
                      epsGrowth: r.epsGrowth,
                    }))
                ).map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    <td className="py-1 text-left tabular-nums" style={{ color: "var(--ws-text)" }}>{r.period}</td>
                    <td className="py-1 text-right font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>
                      {r.revenue != null ? fmtRevenueTwoDecimals(r.revenue) : "—"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums"
                      style={{ color: r.revGrowth != null ? (r.revGrowth >= 0 ? "var(--ws-green)" : "var(--ws-red)") : "var(--ws-text-vdim)" }}>
                      {r.revGrowth != null ? fmtPctSigned(r.revGrowth) : "—"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>
                      {r.eps != null ? r.eps.toFixed(2) : "—"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums"
                      style={{ color: r.epsGrowth != null ? (r.epsGrowth >= 0 ? "var(--ws-green)" : "var(--ws-red)") : "var(--ws-text-vdim)" }}>
                      {r.epsGrowth != null ? fmtPctSigned(r.epsGrowth) : "—"}
                    </td>
                  </tr>
                ))}
                {(finFreq === "annual" ? yearlyRows : quarterlyRows).length === 0 && (
                  <tr><td colSpan={5} className="py-2 text-center" style={{ color: "var(--ws-text-vdim)" }}>No data</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {sectionDivider}

          {/* INSTITUTIONAL OWNERS */}
          <div>
            <div className="text-ws-title font-semibold mb-1.5" style={{ color: "var(--ws-text)" }}>
              Institutional Owners
            </div>
            <table className="w-full text-ws-title" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <th className="py-1 text-left font-medium" style={{ color: "var(--ws-text)" }}>Period</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text)" }}>Count</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text)" }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {ownershipQuarters.slice(0, 8).map((q, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    <td className="py-1.5 text-left tabular-nums" style={{ color: "var(--ws-text)" }}>{fmtDateToQuarter(q.report_date)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>
                      {q.num_funds != null ? q.num_funds.toLocaleString() : "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums"
                      style={{ color: q.num_funds_change != null ? (q.num_funds_change >= 0 ? "var(--ws-green)" : "var(--ws-red)") : "var(--ws-text-vdim)" }}>
                      {q.num_funds_change != null ? `${q.num_funds_change >= 0 ? "+" : ""}${q.num_funds_change.toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
                {ownershipQuarters.length === 0 && (
                  <tr><td colSpan={3} className="py-2 text-center" style={{ color: "var(--ws-text-vdim)" }}>No data</td></tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
        </>
      )}
    </div>
  );
}
