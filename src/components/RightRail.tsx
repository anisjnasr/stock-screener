"use client";

import { useState, useMemo } from "react";
import { type WorkspaceSection } from "@/types/workspace";
import NewsSidebar from "@/components/NewsSidebar";

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

type RightRailProps = {
  section: WorkspaceSection;
  symbol: string;
  profile: ProfileData;
  /** Fallback when profile.mktCap is missing (e.g. from quote.marketCap). */
  marketCap?: number;
  nextEarnings?: string;
  yearlyRows: YearlyRow[];
  quarterlyRows: QuarterlyRow[];
  ownershipQuarters: OwnershipQuarter[];
  fundCount?: number;
  rsRank?: RsRank;
  loading?: boolean;
};

type RailTab = "fundamentals" | "news";

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtShares(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
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

function BarChart({
  data,
  valueKey,
  growthKey,
  periodKey,
  color,
}: {
  data: Array<Record<string, unknown>>;
  valueKey: string;
  growthKey: string;
  periodKey?: string;
  color: string;
}) {
  const display = data.slice(0, 6);
  if (display.length === 0) return null;
  const values = display.map((d) => Number(d[valueKey] ?? 0));
  const maxVal = Math.max(...values.map(Math.abs), 1);
  const hasNegative = values.some((v) => v < 0);
  const barAreaH = 44;

  return (
    <div className="mt-1.5">
      <div className="flex items-end gap-2" style={{ minHeight: hasNegative ? barAreaH * 2 + 8 : barAreaH + 8, position: "relative" }}>
        {display.map((d, i) => {
          const val = Number(d[valueKey] ?? 0);
          const rawGrowth = d[growthKey];
          const growth = typeof rawGrowth === "number" ? rawGrowth : null;
          const barH = Math.max(4, (Math.abs(val) / maxVal) * barAreaH);
          const isNeg = val < 0;
          const period = periodKey ? String(d[periodKey] ?? "") : "";
          const shortPeriod = period.length > 7 ? period.replace(/Quarter /, "Q").replace(/20(\d\d)/, "$1") : period;

          return (
            <div key={i} className="flex flex-col items-center gap-0.5 min-w-0" style={{ width: 36 }}>
              {!isNeg && (
                <span className="text-[10px] font-medium tabular-nums leading-none"
                  style={{ color: growth != null && growth >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}>
                  {growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}%` : ""}
                </span>
              )}
              <div className="w-full rounded-sm" style={{
                height: barH,
                background: isNeg ? "var(--ws-red)" : color,
                opacity: 0.85,
                marginTop: isNeg ? 0 : "auto",
              }} />
              {isNeg && (
                <span className="text-[10px] font-medium tabular-nums leading-none"
                  style={{ color: "var(--ws-red)" }}>
                  {growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}%` : ""}
                </span>
              )}
              {shortPeriod && (
                <span className="text-[9px] tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>{shortPeriod}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default function RightRail({
  section,
  symbol,
  profile,
  marketCap,
  nextEarnings,
  yearlyRows,
  quarterlyRows,
  ownershipQuarters,
  fundCount,
  rsRank,
  loading,
}: RightRailProps) {
  const [railTab, setRailTab] = useState<RailTab>("fundamentals");
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [revenueView, setRevenueView] = useState<"annual" | "quarterly">("quarterly");
  const [epsView, setEpsView] = useState<"annual" | "quarterly">("quarterly");

  const ownershipData = useMemo(() => {
    return ownershipQuarters.slice(0, 8).map((q) => ({
      period: q.report_date,
      value: q.num_funds ?? 0,
      change: q.num_funds_change ?? 0,
    }));
  }, [ownershipQuarters]);

  if (loading) {
    return (
      <div className="h-full p-3 flex items-start" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>Loading…</span>
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

  const qtrData = quarterlyRows.slice(0, 4);
  const latestQtr = qtrData[0];
  const latestYear = yearlyRows[0];

  const latestRevenue = latestQtr?.sales;
  const revenueYoY = latestYear?.salesGrowth;
  const latestEps = latestQtr?.eps;
  const epsYoY = latestYear?.epsGrowth;

  const revenueRange = yearlyRows.length >= 2
    ? `${fmtCompact(yearlyRows[yearlyRows.length - 1]?.sales ?? 0)} → ${fmtCompact(yearlyRows[0]?.sales ?? 0)}`
    : latestRevenue != null ? fmtCompact(latestRevenue) : "—";
  const epsRange = yearlyRows.length >= 2
    ? `$${(yearlyRows[yearlyRows.length - 1]?.eps ?? 0).toFixed(2)} → $${(yearlyRows[0]?.eps ?? 0).toFixed(2)}`
    : latestEps != null ? `$${latestEps.toFixed(2)}` : "—";

  const latestOwnership = ownershipData[0];
  const prevOwnership = ownershipData[1];
  const ownershipTrend = latestOwnership && prevOwnership
    ? latestOwnership.value > prevOwnership.value ? "increasing" : latestOwnership.value < prevOwnership.value ? "decreasing" : "flat"
    : null;

  const bestRs = rsRank
    ? Math.max(rsRank.rs_pct_1w ?? 0, rsRank.rs_pct_1m ?? 0, rsRank.rs_pct_3m ?? 0, rsRank.rs_pct_6m ?? 0, rsRank.rs_pct_12m ?? 0)
    : null;

  const desc = safe(profile?.description);
  const truncatedDesc = desc.length > 150 ? desc.slice(0, 150) + "…" : desc;

  const capValue = profile?.mktCap ?? marketCap;
  const marketCapLabel =
    capValue != null && Number.isFinite(capValue) && capValue > 0 ? fmtCompact(capValue) : "—";
  const floatLabel =
    profile?.floatShares != null && Number.isFinite(profile.floatShares) && profile.floatShares > 0
      ? fmtShares(profile.floatShares)
      : "—";

  const pillClass =
    "text-[10px] px-1.5 py-0.5 rounded inline-block leading-tight";
  const pillStyle = { background: "var(--ws-bg3)", color: "var(--ws-text)" } as const;

  const SectionDivider = () => (
    <div style={{ height: 1, background: "var(--ws-border)", margin: "0 -12px" }} />
  );

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" style={{ background: "var(--ws-bg2)" }}>
      {/* Profile header — order: Ticker, Name, Website, Description, Exchange, Sector, Industry, Market Cap, Float */}
      <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <div className="font-mono text-lg font-bold leading-tight tracking-tight" style={{ color: "var(--ws-text)" }}>
          {symbol}
        </div>
        {profile?.companyName && (
          <div className="text-[12px] mt-1 leading-snug" style={{ color: "var(--ws-text-dim)" }}>
            {safe(profile.companyName)}
          </div>
        )}
        {profile?.website && typeof profile.website === "string" && (
          <a href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
            target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-[11px] font-medium" style={{ color: "var(--ws-cyan)" }}>
            {safe(profile.website).replace(/^https?:\/\//, "")}
          </a>
        )}

        {desc && (
          <div className="mt-2">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
              {showFullDesc ? desc : truncatedDesc}
            </p>
            {desc.length > 150 && (
              <button type="button" onClick={() => setShowFullDesc((v) => !v)} className="text-[10px] mt-0.5" style={{ color: "var(--ws-cyan)" }}>
                {showFullDesc ? "Less" : "More"}
              </button>
            )}
          </div>
        )}

        <div
          className="mt-2 grid gap-x-2 gap-y-1.5 text-[11px] items-center"
          style={{ gridTemplateColumns: "minmax(4.5rem, auto) 1fr" }}
        >
          <span className="font-medium text-[10px]" style={{ color: "var(--ws-text-dim)" }}>Exchange</span>
          <span className="font-medium tabular-nums" style={{ color: "var(--ws-text)" }}>{safe(exchangeFriendlyName(profile?.exchange))}</span>

          <span className="font-medium text-[10px]" style={{ color: "var(--ws-text-dim)" }}>Sector</span>
          <span className="min-w-0 flex flex-wrap gap-1">
            {profile?.sector ? <span className={pillClass} style={pillStyle}>{safe(profile.sector)}</span> : <span style={{ color: "var(--ws-text)" }}>—</span>}
          </span>

          <span className="font-medium text-[10px]" style={{ color: "var(--ws-text-dim)" }}>Industry</span>
          <span className="min-w-0 flex flex-wrap gap-1">
            {profile?.industry ? <span className={pillClass} style={pillStyle}>{safe(profile.industry)}</span> : <span style={{ color: "var(--ws-text)" }}>—</span>}
          </span>

          <span className="font-medium text-[10px]" style={{ color: "var(--ws-text-dim)" }}>Market Cap</span>
          <span className="font-medium font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>{marketCapLabel}</span>

          <span className="font-medium text-[10px]" style={{ color: "var(--ws-text-dim)" }}>Float</span>
          <span className="font-medium font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>{floatLabel}</span>
        </div>
      </div>

      {/* Tab row */}
      <div className="flex items-center gap-0.5 px-3 py-1.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        {(["fundamentals", "news"] as RailTab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => setRailTab(tab)}
            className="px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors capitalize"
            style={{
              background: railTab === tab ? "var(--ws-bg3)" : "transparent",
              color: railTab === tab ? "var(--ws-text)" : "var(--ws-text-dim)",
            }}>
            {tab}
          </button>
        ))}
      </div>

      {railTab === "news" ? (
        <NewsSidebar symbol={symbol} />
      ) : (
        <div className="px-3 py-3 space-y-4">

          {/* REVENUE */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[13px] font-semibold" style={{ color: "var(--ws-text)" }}>Revenue</div>
              <div className="flex gap-0.5">
                {(["annual", "quarterly"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setRevenueView(v)}
                    className="px-2 py-0.5 text-[10px] rounded transition-colors capitalize"
                    style={{ background: revenueView === v ? "var(--ws-bg3)" : "transparent", color: revenueView === v ? "var(--ws-text)" : "var(--ws-text-vdim)" }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[14px] font-mono font-medium" style={{ color: "var(--ws-text)" }}>
              {revenueRange}
            </div>
            {revenueYoY != null && (
              <div className="text-[13px] font-semibold mt-0.5" style={{ color: revenueYoY >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}>
                {fmtPctSigned(revenueYoY)} YoY
              </div>
            )}
            <BarChart
              data={revenueView === "annual" ? yearlyRows.slice(0, 6) : qtrData}
              valueKey="sales"
              growthKey="salesGrowth"
              periodKey={revenueView === "annual" ? "year" : "period"}
              color="var(--ws-cyan)"
            />
          </div>

          <SectionDivider />

          {/* EARNINGS */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[13px] font-semibold" style={{ color: "var(--ws-text)" }}>Earnings (EPS)</div>
              <div className="flex gap-0.5">
                {(["annual", "quarterly"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setEpsView(v)}
                    className="px-2 py-0.5 text-[10px] rounded transition-colors capitalize"
                    style={{ background: epsView === v ? "var(--ws-bg3)" : "transparent", color: epsView === v ? "var(--ws-text)" : "var(--ws-text-vdim)" }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[14px] font-mono font-medium" style={{ color: "var(--ws-text)" }}>
              {epsRange}
            </div>
            {epsYoY != null && (
              <div className="text-[13px] font-semibold mt-0.5" style={{ color: epsYoY >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}>
                {fmtPctSigned(epsYoY)} YoY
              </div>
            )}
            <BarChart
              data={epsView === "annual" ? yearlyRows.slice(0, 6) : qtrData}
              valueKey="eps"
              growthKey="epsGrowth"
              periodKey={epsView === "annual" ? "year" : "period"}
              color="var(--ws-cyan)"
            />
          </div>

          <SectionDivider />

          {/* INSTITUTIONAL */}
          <div>
            <div className="text-[13px] font-semibold mb-1" style={{ color: "var(--ws-text)" }}>
              Fund Counts
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-bold font-mono" style={{ color: "var(--ws-text)" }}>
                {(fundCount ?? latestOwnership?.value ?? 0).toLocaleString()}
              </span>
              <span className="text-[12px]" style={{ color: "var(--ws-text-dim)" }}>holders</span>
              {ownershipTrend && (
                <span className="text-[11px] font-medium" style={{ color: ownershipTrend === "increasing" ? "var(--ws-green)" : ownershipTrend === "decreasing" ? "var(--ws-red)" : "var(--ws-text-dim)" }}>
                  {ownershipTrend === "increasing" ? "▲ Increasing" : ownershipTrend === "decreasing" ? "▼ Decreasing" : "— Flat"}
                </span>
              )}
            </div>
            {ownershipData.length > 0 && (
              <BarChart
                data={ownershipData.slice(0, 6)}
                valueKey="value"
                growthKey="change"
                periodKey="period"
                color="var(--ws-purple, #a78bfa)"
              />
            )}
          </div>

          <SectionDivider />

          {/* RS RANK */}
          {rsRank && bestRs != null && (
            <div>
              <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ws-text)" }}>
                RS Rank
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span
                  className="text-[28px] font-bold font-mono leading-none"
                  style={{ color: bestRs >= 80 ? "var(--ws-green)" : bestRs >= 50 ? "var(--ws-cyan)" : "var(--ws-red)" }}
                >
                  {bestRs.toFixed(0)}
                </span>
                <span className="text-[11px]" style={{ color: "var(--ws-text-dim)" }}>
                  Top {(100 - bestRs).toFixed(0)}%
                </span>
              </div>
              <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    {["1W", "1M", "3M", "6M", "12M"].map((p) => (
                      <th key={p} className="py-1 font-medium text-center" style={{ color: "var(--ws-text-vdim)" }}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {[rsRank.rs_pct_1w, rsRank.rs_pct_1m, rsRank.rs_pct_3m, rsRank.rs_pct_6m, rsRank.rs_pct_12m].map((v, i) => (
                      <td key={i} className="py-1 text-center font-mono font-medium tabular-nums"
                        style={{ color: v != null ? (v >= 80 ? "var(--ws-green)" : v >= 50 ? "var(--ws-text)" : "var(--ws-red)") : "var(--ws-text-vdim)" }}>
                        {v != null ? v.toFixed(0) : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {nextEarnings && (
            <div className="text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>
              Next earnings: <span style={{ color: "var(--ws-text-dim)" }}>{safe(nextEarnings)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
