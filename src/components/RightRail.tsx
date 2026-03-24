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

type RightRailProps = {
  section: WorkspaceSection;
  symbol: string;
  profile: ProfileData;
  nextEarnings?: string;
  yearlyRows: YearlyRow[];
  quarterlyRows: QuarterlyRow[];
  ownershipQuarters: OwnershipQuarter[];
  loading?: boolean;
};

type FinancialTab = "revenue" | "eps";
type RailTab = "fundamentals" | "news";

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(1);
}

function fmtPct(n: number | null): string {
  if (n == null) return "";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function MiniBarChart({
  data,
  labelKey,
  valueKey,
  growthKey,
  color,
}: {
  data: Array<Record<string, unknown>>;
  labelKey: string;
  valueKey: string;
  growthKey: string;
  color: string;
}) {
  if (data.length === 0) {
    return (
      <div className="h-20 flex items-center justify-center">
        <span className="text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>No data</span>
      </div>
    );
  }

  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const maxVal = Math.max(...values.map(Math.abs), 1);

  return (
    <div className="flex items-end gap-[2px] h-20 px-1">
      {data.map((d, i) => {
        const val = Number(d[valueKey] ?? 0);
        const growth = d[growthKey] as number | null;
        const barH = Math.max(2, (Math.abs(val) / maxVal) * 64);
        const label = String(d[labelKey] ?? "");
        return (
          <div key={label || i} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
            {growth != null && (
              <span
                className="text-[8px] tabular-nums leading-none truncate w-full text-center"
                style={{ color: growth >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}
              >
                {fmtPct(growth)}
              </span>
            )}
            <div
              className="w-full rounded-sm"
              style={{ height: barH, background: color, opacity: 0.8 }}
            />
            <span
              className="text-[8px] leading-none truncate w-full text-center"
              style={{ color: "var(--ws-text-vdim)" }}
            >
              {label.length > 6 ? label.slice(-6) : label}
            </span>
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
  loading,
}: RightRailProps) {
  const [annualTab, setAnnualTab] = useState<FinancialTab>("revenue");
  const [quarterlyTab, setQuarterlyTab] = useState<FinancialTab>("revenue");
  const [railTab, setRailTab] = useState<RailTab>("fundamentals");

  if (loading) {
    return (
      <div className="h-full p-3 flex items-start" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>Loading…</span>
      </div>
    );
  }

  const annualData = useMemo(() => yearlyRows.slice(0, 8), [yearlyRows]);
  const qtrData = useMemo(() => quarterlyRows.slice(0, 8), [quarterlyRows]);
  const ownershipData = useMemo(() => {
    return ownershipQuarters.slice(0, 8).map((q) => ({
      period: q.report_date,
      value: q.num_funds ?? 0,
      change: q.num_funds_change ?? 0,
    }));
  }, [ownershipQuarters]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" style={{ background: "var(--ws-bg2)" }}>
      {/* Profile header */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold font-mono" style={{ color: "var(--ws-text)" }}>
            {symbol}
          </span>
          <span className="text-[11px] truncate" style={{ color: "var(--ws-text-dim)" }}>
            {profile?.companyName ?? ""}
          </span>
        </div>
        {(profile?.sector || profile?.industry) && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {profile?.sector && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)" }}
              >
                {profile.sector}
              </span>
            )}
            {profile?.industry && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)" }}
              >
                {profile.industry}
              </span>
            )}
          </div>
        )}
        {nextEarnings && (
          <div className="mt-1 text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>
            Next earnings: {nextEarnings}
          </div>
        )}
      </div>

      {/* Tab row: Fundamentals | News */}
      <div className="flex items-center gap-0.5 px-3 py-1" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        {(["fundamentals", "news"] as RailTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setRailTab(tab)}
            className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors capitalize"
            style={{
              background: railTab === tab ? "var(--ws-bg3)" : "transparent",
              color: railTab === tab ? "var(--ws-text)" : "var(--ws-text-dim)",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {railTab === "news" ? (
        <NewsSidebar symbol={symbol} />
      ) : (
        <div className="px-2 py-2 space-y-3">
          {/* Annual financials chart */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
                Annual
              </span>
              <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--ws-bg)" }}>
                {(["revenue", "eps"] as FinancialTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAnnualTab(t)}
                    className="px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors uppercase"
                    style={{
                      background: annualTab === t ? "var(--ws-cyan)" : "transparent",
                      color: annualTab === t ? "var(--ws-bg)" : "var(--ws-text-dim)",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <MiniBarChart
              data={annualData}
              labelKey="year"
              valueKey={annualTab === "revenue" ? "sales" : "eps"}
              growthKey={annualTab === "revenue" ? "salesGrowth" : "epsGrowth"}
              color={annualTab === "revenue" ? "var(--ws-blue)" : "var(--ws-cyan)"}
            />
          </div>

          {/* Quarterly financials chart */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
                Quarterly
              </span>
              <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--ws-bg)" }}>
                {(["revenue", "eps"] as FinancialTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setQuarterlyTab(t)}
                    className="px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors uppercase"
                    style={{
                      background: quarterlyTab === t ? "var(--ws-cyan)" : "transparent",
                      color: quarterlyTab === t ? "var(--ws-bg)" : "var(--ws-text-dim)",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <MiniBarChart
              data={qtrData}
              labelKey="period"
              valueKey={quarterlyTab === "revenue" ? "sales" : "eps"}
              growthKey={quarterlyTab === "revenue" ? "salesGrowth" : "epsGrowth"}
              color={quarterlyTab === "revenue" ? "var(--ws-blue)" : "var(--ws-cyan)"}
            />
          </div>

          {/* Fund counts chart */}
          {ownershipData.length > 0 && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--ws-text-dim)" }}>
                Institutional Funds
              </span>
              <MiniBarChart
                data={ownershipData}
                labelKey="period"
                valueKey="value"
                growthKey="change"
                color="var(--ws-purple)"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
