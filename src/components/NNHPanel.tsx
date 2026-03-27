"use client";

import { useState, useEffect, useMemo } from "react";

type NNHRow = { date: string; highs: number; lows: number; net: number };
type Horizon = "oneMonth" | "threeMonths" | "sixMonths" | "fiftyTwoWeek";

const HORIZON_LABELS: Record<Horizon, string> = {
  oneMonth: "1M",
  threeMonths: "3M",
  sixMonths: "6M",
  fiftyTwoWeek: "52W",
};

type NNHPanelProps = {
  visibleRange: { from: string; to: string } | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function NNHPanel({ visibleRange, collapsed, onToggleCollapse }: NNHPanelProps) {
  const [allData, setAllData] = useState<Record<Horizon, NNHRow[]> | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("fiftyTwoWeek");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/breadth?index=sp500")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const nnh = json?.netNewHighs;
        if (nnh) {
          setAllData({
            oneMonth: nnh.oneMonth ?? [],
            threeMonths: nnh.threeMonths ?? [],
            sixMonths: nnh.sixMonths ?? [],
            fiftyTwoWeek: nnh.fiftyTwoWeek ?? [],
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filteredData = useMemo(() => {
    if (!allData) return [];
    const series = allData[horizon] ?? [];
    if (!visibleRange) return series;
    return series.filter((r) => r.date >= visibleRange.from && r.date <= visibleRange.to);
  }, [allData, horizon, visibleRange]);

  const maxAbs = filteredData.reduce((mx, r) => Math.max(mx, Math.abs(r.net)), 1);

  return (
    <div style={{ borderTop: "1px solid var(--ws-border)" }}>
      {/* Header row — always visible, entire bar toggles collapse */}
      <div
        className="flex items-center gap-2 px-2 h-7 cursor-pointer"
        style={{ background: "var(--ws-bg2)" }}
        onClick={onToggleCollapse}
      >
        <div className="flex-1" />
        <div
          className="flex items-center gap-0.5 rounded p-0.5"
          style={{ background: "var(--ws-bg)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {(Object.keys(HORIZON_LABELS) as Horizon[]).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              className="px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors"
              style={{
                background: horizon === h ? "var(--ws-cyan)" : "transparent",
                color: horizon === h ? "var(--ws-bg)" : "var(--ws-text-dim)",
              }}
            >
              {HORIZON_LABELS[h]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            NNH
          </span>
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            {collapsed ? (
              <path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </div>
      </div>

      {/* Chart area — hidden when collapsed */}
      {!collapsed && (
        <div className="h-28 px-1 pb-1" style={{ background: "var(--ws-bg)" }}>
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>Loading…</span>
            </div>
          ) : filteredData.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>No data in range</span>
            </div>
          ) : (
            <svg viewBox={`0 0 ${filteredData.length} 100`} preserveAspectRatio="none" className="w-full h-full">
              {filteredData.map((r, i) => {
                const barHeight = (Math.abs(r.net) / maxAbs) * 45;
                const isPositive = r.net >= 0;
                return (
                  <g key={r.date}>
                    <line x1={i} y1="0" x2={i} y2="100" stroke="var(--ws-border)" strokeWidth="0.3" opacity="0.4" />
                    <rect
                      x={i + 0.1}
                      y={isPositive ? 50 - barHeight : 50}
                      width={0.8}
                      height={Math.max(0.5, barHeight)}
                      fill={isPositive ? "var(--ws-green)" : "var(--ws-red)"}
                      opacity={0.8}
                    />
                  </g>
                );
              })}
              <line x1="0" y1="50" x2={filteredData.length} y2="50" stroke="var(--ws-border-hover)" strokeWidth="0.5" />
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
