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

type FinMetric = "revenue" | "eps";

export default function RightRail({
  section,
  symbol,
  profile,
  marketCap,
  nextEarnings,
  yearlyRows,
  quarterlyRows,
  ownershipQuarters,
  rsRank,
  loading,
}: RightRailProps) {
  const [railTab, setRailTab] = useState<RailTab>("fundamentals");
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [finMetric, setFinMetric] = useState<FinMetric>("revenue");
  const [finFreq, setFinFreq] = useState<"annual" | "quarterly">("quarterly");

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


  const desc = safe(profile?.description);
  const truncatedDesc = desc.length > 150 ? desc.slice(0, 150) + "…" : desc;

  const capValue = profile?.mktCap ?? marketCap;
  const marketCapLabel =
    capValue != null && Number.isFinite(capValue) && capValue > 0 ? fmtCompact(capValue) : "—";
  const floatLabel =
    profile?.floatShares != null && Number.isFinite(profile.floatShares) && profile.floatShares > 0
      ? fmtShares(profile.floatShares)
      : "—";

  const SectionDivider = () => (
    <div style={{ height: 1, background: "var(--ws-border)", margin: "0 -12px" }} />
  );

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" style={{ background: "var(--ws-bg2)" }}>
      {/* Profile header — order: Ticker + Name inline, Website, Description, Exchange, Sector, Industry, Market Cap, Float */}
      <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold leading-tight tracking-tight" style={{ color: "var(--ws-text)" }}>
            {symbol}
          </span>
          {profile?.companyName && (
            <span className="text-[15px] font-semibold leading-snug truncate min-w-0" style={{ color: "rgba(201,209,217,0.85)" }}>
              {safe(profile.companyName)}
            </span>
          )}
        </div>
        {profile?.website && typeof profile.website === "string" && (
          <a href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
            target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-[12px] font-medium" style={{ color: "var(--ws-cyan)" }}>
            {safe(profile.website).replace(/^https?:\/\//, "")}
          </a>
        )}

        {desc && (
          <div className="mt-2">
            <p className="text-[12px] leading-relaxed" style={{ color: "rgba(201,209,217,0.8)" }}>
              {showFullDesc ? desc : truncatedDesc}
            </p>
            {desc.length > 150 && (
              <button type="button" onClick={() => setShowFullDesc((v) => !v)} className="text-[11px] mt-0.5" style={{ color: "var(--ws-cyan)" }}>
                {showFullDesc ? "Less" : "More"}
              </button>
            )}
          </div>
        )}

        <div
          className="mt-2 grid gap-x-2 gap-y-1.5 text-[13px] items-center"
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

          <span className="font-medium" style={{ color: "rgba(201,209,217,0.7)" }}>Float</span>
          <span className="font-medium font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>{floatLabel}</span>
        </div>
      </div>

      {/* Tab row */}
      <div className="flex items-center gap-1 px-3 py-2" role="tablist" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        {(["fundamentals", "news"] as RailTab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => setRailTab(tab)}
            role="tab"
            aria-selected={railTab === tab}
            className={`px-3 py-1 text-[13px] font-semibold rounded transition-colors capitalize ws-focus-ring ${railTab !== tab ? "hover:bg-white/[0.06]" : ""}`}
            style={{
              background: railTab === tab ? "var(--ws-bg3)" : undefined,
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

          {/* RS RANK */}
          {rsRank && (
            <div>
              <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ws-text)" }}>
                RS Rank
              </div>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
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
                      <td key={i} className="py-1.5 text-center font-mono font-semibold tabular-nums text-[13px]"
                        style={{ color: v != null ? (v >= 80 ? "var(--ws-green)" : v <= 30 ? "var(--ws-red)" : "var(--ws-text)") : "var(--ws-text-vdim)" }}>
                        {v != null ? v.toFixed(0) : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {rsRank && <SectionDivider />}

          {/* REVENUE / EPS — unified table */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              {(["revenue", "eps"] as FinMetric[]).map((m) => (
                <button key={m} type="button" onClick={() => setFinMetric(m)}
                  aria-pressed={finMetric === m}
                  className={`px-3 py-0.5 text-[13px] font-semibold rounded transition-colors ws-focus-ring ${finMetric !== m ? "hover:bg-white/[0.06]" : ""}`}
                  style={{ background: finMetric === m ? "var(--ws-bg3)" : undefined, color: finMetric === m ? "var(--ws-text)" : "var(--ws-text-vdim)" }}>
                  {m === "revenue" ? "Revenue" : "EPS"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 mb-2">
              {(["annual", "quarterly"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setFinFreq(v)}
                  aria-pressed={finFreq === v}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors capitalize ws-focus-ring ${finFreq !== v ? "hover:bg-white/[0.06]" : ""}`}
                  style={{ background: finFreq === v ? "var(--ws-bg3)" : undefined, color: finFreq === v ? "var(--ws-text)" : "var(--ws-text-vdim)" }}>
                  {v}
                </button>
              ))}
            </div>
            {nextEarnings && (
              <div className="text-[11px] mb-1.5" style={{ color: "var(--ws-text-vdim)" }}>
                Next earnings: <span style={{ color: "var(--ws-text-dim)" }}>{safe(nextEarnings)}</span>
              </div>
            )}
            <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <th className="py-1 text-left font-medium" style={{ color: "var(--ws-text-vdim)" }}>Period</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text-vdim)" }}>
                    {finMetric === "revenue" ? "Revenue" : "EPS"}
                  </th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text-vdim)" }}>YoY</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text-vdim)" }}>Surprise</th>
                </tr>
              </thead>
              <tbody>
                {(finFreq === "annual"
                  ? yearlyRows.slice(0, 8).map((r) => ({
                      period: fmtPeriodShort(r.year),
                      value: finMetric === "revenue" ? r.sales : r.eps,
                      growth: finMetric === "revenue" ? r.salesGrowth : r.epsGrowth,
                    }))
                  : quarterlyRows.slice(0, 8).map((r) => ({
                      period: fmtPeriodShort(r.period),
                      value: finMetric === "revenue" ? r.sales : r.eps,
                      growth: finMetric === "revenue" ? r.salesGrowth : r.epsGrowth,
                    }))
                ).map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    <td className="py-1.5 text-left tabular-nums" style={{ color: "var(--ws-text-dim)" }}>{r.period}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>
                      {r.value != null
                        ? (finMetric === "revenue" ? fmtCompact(r.value) : `$${r.value.toFixed(2)}`)
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums"
                      style={{ color: r.growth != null ? (r.growth >= 0 ? "var(--ws-green)" : "var(--ws-red)") : "var(--ws-text-vdim)" }}>
                      {r.growth != null ? fmtPctSigned(r.growth) : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>—</td>
                  </tr>
                ))}
                {(finFreq === "annual" ? yearlyRows : quarterlyRows).length === 0 && (
                  <tr><td colSpan={4} className="py-2 text-center" style={{ color: "var(--ws-text-vdim)" }}>No data</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <SectionDivider />

          {/* INSTITUTIONAL OWNERS */}
          <div>
            <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ws-text)" }}>
              Institutional Owners
            </div>
            <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <th className="py-1 text-left font-medium" style={{ color: "var(--ws-text-vdim)" }}>Period</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text-vdim)" }}>Count</th>
                  <th className="py-1 text-right font-medium" style={{ color: "var(--ws-text-vdim)" }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {ownershipQuarters.slice(0, 8).map((q, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--ws-border)" }}>
                    <td className="py-1.5 text-left tabular-nums" style={{ color: "var(--ws-text-dim)" }}>{fmtDateToQuarter(q.report_date)}</td>
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
      )}
    </div>
  );
}
