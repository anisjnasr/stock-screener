"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { SectorSubTab, SectorTimeframe } from "@/components/WorkspaceHeader";

type PerfItem = {
  id: string;
  name: string;
  ticker?: string;
  changePct: number | null;
};

type ApiResponse = {
  indices: Array<{ id: string; name: string; ticker: string; changePct: number | null }>;
  sectors: Array<{ id: string; name: string; changePct: number | null }>;
  industries: Array<{ id: string; name: string; changePct: number | null }>;
  themes: Array<{ id: string; category: string; name: string; ticker: string; changePct: number | null }>;
  error?: string;
};

const SECTOR_ETF_MAP: Record<string, string> = {
  "Technology": "XLK", "Financial Services": "XLF", "Healthcare": "XLV",
  "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP", "Communication Services": "XLC",
  "Industrials": "XLI", "Energy": "XLE", "Basic Materials": "XLB",
  "Real Estate": "XLRE", "Utilities": "XLU",
};

const INDUSTRY_ETF_MAP: Record<string, string> = {
  "Aerospace & Defense": "ITA", "Airlines": "JETS", "Auto Manufacturers": "CARZ",
  "Banks - Diversified": "KBE", "Banks - Regional": "KRE", "Packaged Foods": "PBJ",
  "Biotechnology": "XBI", "Capital Markets": "KCE", "Pharmaceutical Retailers": "XPH",
  "Gambling": "BETZ", "Gold": "GDX", "Health Care Providers": "IHF",
  "Residential Construction": "ITB", "Insurance - Diversified": "KIE",
  "Medical Devices": "IHI", "Steel": "XME", "Oil & Gas E&P": "XOP",
  "REIT - Diversified": "VNQ", "Semiconductors": "SMH", "Software - Infrastructure": "IGV",
  "Specialty Retail": "XRT", "Telecom Services": "IYZ", "Integrated Freight & Logistics": "IYT",
};

const TF_API: Record<SectorTimeframe, string> = {
  "1d": "day", "1w": "week", "1m": "month", "q": "quarter", "6m": "half_year", "y": "year", "ytd": "ytd",
};

const TF_LABELS: Record<SectorTimeframe, string> = {
  "1d": "Day", "1w": "1 Week", "1m": "1 Month", "q": "3 Months", "6m": "Half Year", "y": "1 Year", "ytd": "YTD",
};

function toSentenceCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function SectorPerfPanel({
  subTab,
  timeframe,
  onTimeframeChange,
  onDrillDown,
  onSymbolSelect,
}: {
  subTab: SectorSubTab;
  timeframe: SectorTimeframe;
  onTimeframeChange?: (tf: SectorTimeframe) => void;
  onDrillDown?: (kind: "sector" | "industry" | "theme" | "index", value: string) => void;
  onSymbolSelect?: (sym: string) => void;
}) {
  const [payload, setPayload] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortAsc, setSortAsc] = useState(false);

  const apiTf = TF_API[timeframe] ?? "week";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sectors-industries?indicesTimeframe=${apiTf}&sectorsTimeframe=${apiTf}&industriesTimeframe=${apiTf}&themesTimeframe=${apiTf}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((json) => {
        if (cancelled) return;
        if (json.error) { setError(json.error); setPayload(null); return; }
        setPayload(json);
      })
      .catch(() => { if (!cancelled) { setError("Failed to load"); setPayload(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiTf]);

  const items: PerfItem[] = useMemo(() => {
    if (!payload) return [];
    if (subTab === "sectors")
      return (payload.sectors ?? []).map((x) => ({
        id: x.id, name: x.name, ticker: SECTOR_ETF_MAP[x.name], changePct: x.changePct,
      }));
    if (subTab === "industries")
      return (payload.industries ?? [])
        .map((x) => ({ id: x.id, name: toSentenceCase(x.name), changePct: x.changePct }))
        .filter((x) => INDUSTRY_ETF_MAP[x.name])
        .map((x) => ({ ...x, ticker: INDUSTRY_ETF_MAP[x.name] }));
    if (subTab === "thematic")
      return (payload.themes ?? []).map((x) => ({
        id: x.id, name: toSentenceCase(x.name), ticker: x.ticker, changePct: x.changePct,
      }));
    return [];
  }, [payload, subTab]);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        sortAsc
          ? (a.changePct ?? -Infinity) - (b.changePct ?? -Infinity)
          : (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)
      ),
    [items, sortAsc]
  );

  const maxAbs = useMemo(
    () => Math.max(0.01, ...sorted.map((s) => Math.abs(s.changePct ?? 0))),
    [sorted]
  );

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelectedIdx(0), [subTab, timeframe]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      e.preventDefault();
      setSelectedIdx((prev) => {
        const next = e.key === "ArrowDown" ? Math.min(sorted.length - 1, prev + 1) : Math.max(0, prev - 1);
        const row = sorted[next];
        if (row?.ticker) onSymbolSelect?.(row.ticker);
        return next;
      });
    },
    [sorted, onSymbolSelect]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const row = container.children[selectedIdx] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-text-vdim)" }}>Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-red)" }}>{error}</span>
      </div>
    );
  }

  const panelTitle = subTab === "sectors" ? "Sectors" : subTab === "industries" ? "Industries" : "Thematic ETFs";

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      <div className="flex items-center px-2 py-1.5 shrink-0 gap-4" style={{ background: "var(--ws-bg2)", borderBottom: "1px solid var(--ws-border)" }}>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[15px] font-semibold" style={{ color: "var(--ws-text)" }}>{panelTitle}</span>
          <span className="text-[14px] tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
            ({loading ? "…" : sorted.length})
          </span>
        </div>
        {onTimeframeChange && (
          <div className="flex items-center gap-1 flex-wrap">
            {(["1d", "1w", "1m", "q", "6m", "y", "ytd"] as SectorTimeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ws-focus-ring ${timeframe !== tf ? "hover:bg-white/[0.06]" : ""}`}
                style={{
                  background: timeframe === tf ? "rgba(0,229,204,0.12)" : undefined,
                  color: timeframe === tf ? "var(--ws-cyan)" : "var(--ws-text-vdim)",
                  border: timeframe === tf ? "1px solid rgba(0,229,204,0.2)" : "1px solid transparent",
                }}
                aria-pressed={timeframe === tf}
              >
                {TF_LABELS[tf]}
              </button>
            ))}
            <button
              type="button"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ml-1"
              style={{ color: sortAsc ? "var(--ws-cyan)" : "var(--ws-text-dim)", background: "rgba(255,255,255,0.04)" }}
              title={sortAsc ? "Sorted ascending — click to sort descending" : "Sorted descending — click to sort ascending"}
              onClick={() => { setSortAsc((v) => !v); setSelectedIdx(0); }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {sortAsc ? (
                  <>
                    <line x1="8" y1="13" x2="8" y2="3" />
                    <polyline points="4,7 8,3 12,7" />
                  </>
                ) : (
                  <>
                    <line x1="8" y1="3" x2="8" y2="13" />
                    <polyline points="4,9 8,13 12,9" />
                  </>
                )}
              </svg>
              {sortAsc ? "Asc" : "Desc"}
            </button>
          </div>
        )}
        <div className="flex-1" />
        {sorted[selectedIdx] && onDrillDown && (
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] cursor-pointer transition-colors shrink-0"
            style={{ color: "var(--ws-cyan)", background: "rgba(0,229,204,0.08)" }}
            title={`View ${sorted[selectedIdx]?.ticker ?? sorted[selectedIdx]?.name} constituents`}
            onClick={() => {
              const s = sorted[selectedIdx];
              const kind = subTab === "sectors" ? "sector" : subTab === "industries" ? "industry" : "theme";
              onDrillDown(kind, subTab === "thematic" ? s.id : s.name);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5zm-3-8a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm0 4a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm0 4a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>
          </button>
        )}
      </div>
      <div ref={listRef} className="flex-1 overflow-auto" style={{ maxWidth: "50vw" }}>
        {sorted.map((s, i) => {
          const pct = s.changePct ?? 0;
          const isPos = pct >= 0;
          const barPct = (Math.abs(pct) / maxAbs) * 100;
          const barWidth = `${barPct}%`;
          const isSelected = i === selectedIdx;
          const pctLabel = `${isPos ? "+" : ""}${pct.toFixed(2)}%`;
          const labelInside = barPct > 65;
          return (
            <div
              key={s.id}
              className="grid items-center px-2 py-[5px] cursor-pointer ws-row-hover ws-focus-ring"
              role="button"
              tabIndex={0}
              aria-label={`${s.ticker ?? s.name}: ${pctLabel}`}
              aria-pressed={isSelected}
              style={{
                gridTemplateColumns: `auto minmax(0, 200px) 1fr ${onDrillDown ? "36px" : ""}`,
                gap: "6px",
                background: isSelected ? "rgba(0,229,204,0.08)" : undefined,
                borderBottom: "1px solid var(--ws-border)",
              }}
              onClick={() => {
                setSelectedIdx(i);
                if (s.ticker) onSymbolSelect?.(s.ticker);
              }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedIdx(i); if (s.ticker) onSymbolSelect?.(s.ticker); } }}
            >
              <span
                className="font-mono text-[13px] leading-snug whitespace-nowrap"
                style={{
                  fontWeight: isSelected ? 600 : 400,
                  color: "var(--ws-cyan)",
                  minWidth: 40,
                }}
              >
                {s.ticker ?? ""}
              </span>
              <span
                className="text-[13px] leading-snug truncate"
                style={{
                  fontWeight: isSelected ? 500 : 400,
                  color: "#ffffff",
                }}
              >
                {s.name}
              </span>
              <div className="flex items-center h-[36px]">
                <div
                  className="flex justify-end items-center self-stretch"
                  style={{ width: "50%", borderRight: "1px solid var(--ws-border)" }}
                >
                  {!isPos && (
                    <div className="flex items-center" style={{ width: barWidth, maxWidth: "100%", justifyContent: labelInside ? "flex-start" : "flex-end" }}>
                      {!labelInside && (
                        <span className="shrink-0 font-mono text-[15px] tabular-nums mr-1.5" style={{ color: "var(--ws-red)" }}>
                          {pctLabel}
                        </span>
                      )}
                      <div
                        style={{
                          width: "100%",
                          height: 32,
                          borderRadius: "3px 0 0 3px",
                          background: "var(--ws-red)",
                          opacity: 0.7,
                          position: "relative",
                        }}
                      >
                        {labelInside && (
                          <span className="absolute inset-0 flex items-center justify-start pl-2.5 font-mono text-[14px] tabular-nums font-semibold" style={{ color: "#1a0a0a" }}>
                            {pctLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className="flex justify-start items-center self-stretch"
                  style={{ width: "50%" }}
                >
                  {isPos && (
                    <div className="flex items-center" style={{ width: barWidth, maxWidth: "100%", justifyContent: labelInside ? "flex-end" : "flex-start" }}>
                      <div
                        style={{
                          width: "100%",
                          height: 32,
                          borderRadius: "0 3px 3px 0",
                          background: "var(--ws-green)",
                          opacity: 0.7,
                          position: "relative",
                        }}
                      >
                        {labelInside && (
                          <span className="absolute inset-0 flex items-center justify-end pr-2.5 font-mono text-[14px] tabular-nums font-semibold" style={{ color: "#0a1a12" }}>
                            {pctLabel}
                          </span>
                        )}
                      </div>
                      {!labelInside && (
                        <span className="shrink-0 font-mono text-[15px] tabular-nums ml-1.5" style={{ color: "var(--ws-green)" }}>
                          {pctLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {onDrillDown && (
                <div
                  className="flex items-center justify-center rounded cursor-pointer transition-all hover:bg-white/[0.06] ws-focus-ring"
                  role="button"
                  tabIndex={0}
                  aria-label={`Drill into ${s.name}`}
                  style={{ width: 32, height: 32, color: "var(--ws-cyan)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const kind = subTab === "sectors" ? "sector" : subTab === "industries" ? "industry" : "theme";
                    onDrillDown(kind, subTab === "thematic" ? s.id : s.name);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); const kind = subTab === "sectors" ? "sector" : subTab === "industries" ? "industry" : "theme"; onDrillDown(kind, subTab === "thematic" ? s.id : s.name); } }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
                    <circle cx="8" cy="8" r="6" />
                    <line x1="8" y1="4" x2="8" y2="12" />
                    <line x1="4" y1="8" x2="12" y2="8" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
