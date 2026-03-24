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

function fmtPctSigned(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}

function QuarterlyBars({
  data,
  valueKey,
  growthKey,
  color,
}: {
  data: Array<Record<string, unknown>>;
  valueKey: string;
  growthKey: string;
  color: string;
}) {
  const display = data.slice(0, 4);
  if (display.length === 0) return null;
  const values = display.map((d) => Number(d[valueKey] ?? 0));
  const maxVal = Math.max(...values.map(Math.abs), 1);

  return (
    <div className="flex items-end gap-2 mt-1.5">
      {display.map((d, i) => {
        const val = Number(d[valueKey] ?? 0);
        const growth = d[growthKey] as number | null;
        const barH = Math.max(5, (Math.abs(val) / maxVal) * 44);
        return (
          <div key={i} className="flex flex-col items-center gap-0.5 min-w-0" style={{ width: 32 }}>
            <span
              className="text-[10px] font-medium tabular-nums leading-none"
              style={{ color: growth != null && growth >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}
            >
              {growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}%` : ""}
            </span>
            <div className="w-full rounded-sm" style={{ height: barH, background: color, opacity: 0.85 }} />
          </div>
        );
      })}
    </div>
  );
}


export default function RightRail({
  section,
  symbol,
  profile,
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

  if (loading) {
    return (
      <div className="h-full p-3 flex items-start" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>Loading…</span>
      </div>
    );
  }

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

  const ownershipData = useMemo(() => {
    return ownershipQuarters.slice(0, 8).map((q) => ({
      period: q.report_date,
      value: q.num_funds ?? 0,
      change: q.num_funds_change ?? 0,
    }));
  }, [ownershipQuarters]);

  const latestOwnership = ownershipData[0];
  const prevOwnership = ownershipData[1];
  const ownershipTrend = latestOwnership && prevOwnership
    ? latestOwnership.value > prevOwnership.value ? "increasing" : latestOwnership.value < prevOwnership.value ? "decreasing" : "flat"
    : null;

  const bestRs = rsRank
    ? Math.max(rsRank.rs_pct_1w ?? 0, rsRank.rs_pct_1m ?? 0, rsRank.rs_pct_3m ?? 0, rsRank.rs_pct_6m ?? 0, rsRank.rs_pct_12m ?? 0)
    : null;

  const desc = profile?.description ?? "";
  const truncatedDesc = desc.length > 150 ? desc.slice(0, 150) + "…" : desc;

  const SectionDivider = () => (
    <div style={{ height: 1, background: "var(--ws-border)", margin: "0 -12px" }} />
  );

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" style={{ background: "var(--ws-bg2)" }}>
      {/* Profile header */}
      <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold font-mono" style={{ color: "var(--ws-text)" }}>
            {symbol}
          </span>
          <span className="text-[11px] truncate" style={{ color: "var(--ws-text-dim)" }}>
            {profile?.companyName ?? ""}
          </span>
        </div>
        {(profile?.sector || profile?.industry) && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {profile?.sector && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)" }}>
                {profile.sector}
              </span>
            )}
            {profile?.industry && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)" }}>
                {profile.industry}
              </span>
            )}
          </div>
        )}
        {desc && (
          <div className="mt-1.5">
            <p className="text-[10px] leading-relaxed" style={{ color: "var(--ws-text-vdim)" }}>
              {showFullDesc ? desc : truncatedDesc}
            </p>
            {desc.length > 150 && (
              <button type="button" onClick={() => setShowFullDesc((v) => !v)} className="text-[10px] mt-0.5" style={{ color: "var(--ws-cyan)" }}>
                {showFullDesc ? "Less" : "More"}
              </button>
            )}
          </div>
        )}
        {profile?.website && (
          <a href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
            target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-[10px]" style={{ color: "var(--ws-cyan)" }}>
            {profile.website.replace(/^https?:\/\//, "")}
          </a>
        )}
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
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--ws-text-vdim)" }}>
              Revenue
            </div>
            <div className="text-[14px] font-mono font-medium" style={{ color: "var(--ws-text)" }}>
              {revenueRange}
            </div>
            {revenueYoY != null && (
              <div className="text-[13px] font-semibold mt-0.5" style={{ color: revenueYoY >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}>
                {fmtPctSigned(revenueYoY)} YoY
              </div>
            )}
            <div className="text-[11px] mt-2 mb-0.5" style={{ color: "var(--ws-text-vdim)" }}>Quarterly</div>
            <QuarterlyBars data={qtrData} valueKey="sales" growthKey="salesGrowth" color="var(--ws-cyan)" />
          </div>

          <SectionDivider />

          {/* EARNINGS */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--ws-text-vdim)" }}>
              Earnings
            </div>
            <div className="text-[14px] font-mono font-medium" style={{ color: "var(--ws-text)" }}>
              {epsRange}
            </div>
            {epsYoY != null && (
              <div className="text-[13px] font-semibold mt-0.5" style={{ color: epsYoY >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}>
                {fmtPctSigned(epsYoY)} YoY
              </div>
            )}
            <div className="text-[11px] mt-2 mb-0.5" style={{ color: "var(--ws-text-vdim)" }}>Quarterly</div>
            <QuarterlyBars data={qtrData} valueKey="eps" growthKey="epsGrowth" color="var(--ws-cyan)" />
            {/* Surprise row */}
            {qtrData.some((q) => q.epsGrowth != null) && (
              <div className="mt-1.5">
                <div className="text-[10px] mb-0.5" style={{ color: "var(--ws-text-vdim)" }}>Surprise</div>
                <div className="flex gap-1.5">
                  {qtrData.slice(0, 4).map((q, i) => (
                    <span key={i} className="text-[10px] font-medium tabular-nums"
                      style={{ color: (q.epsGrowth ?? 0) >= 0 ? "var(--ws-green)" : "var(--ws-red)", width: 28, textAlign: "center", display: "inline-block" }}>
                      {q.epsGrowth != null ? `${q.epsGrowth >= 0 ? "+" : ""}${q.epsGrowth.toFixed(0)}%` : "—"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <SectionDivider />

          {/* INSTITUTIONAL */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--ws-text-vdim)" }}>
              Institutional
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
              <QuarterlyBars
                data={ownershipData.slice(0, 4)}
                valueKey="value"
                growthKey="change"
                color="var(--ws-purple, #a78bfa)"
              />
            )}
          </div>

          <SectionDivider />

          {/* RS RANK */}
          {rsRank && bestRs != null && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--ws-text-vdim)" }}>
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
              Next earnings: <span style={{ color: "var(--ws-text-dim)" }}>{nextEarnings}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
