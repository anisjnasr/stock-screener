"use client";

import { useEffect, useMemo, useState } from "react";

type BreadthPoint = {
  date: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
};

type BreadthResponse = {
  breadth: BreadthPoint[];
};

function Sparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={height} className="shrink-0">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.5" opacity="0.7" />
      <line x1="0" y1={height - ((50 - min) / range) * (height - 4) - 2} x2={w} y2={height - ((50 - min) / range) * (height - 4) - 2}
        stroke="var(--ws-border-hover)" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.5" />
    </svg>
  );
}

function BreadthMetric({
  label,
  value,
  sparkData,
  color,
}: {
  label: string;
  value: number | null;
  sparkData: number[];
  color: string;
}) {
  const displayVal = value != null ? `${value.toFixed(1)}%` : "—";
  const amber = "#f59e0b";
  const pctColor =
    value == null
      ? "var(--ws-text-vdim)"
      : value > 45
        ? "var(--ws-text)"
        : value >= 25
          ? amber
          : "var(--ws-red)";
  const status =
    value == null
      ? null
      : value > 45
        ? { label: "Healthy" as const, color: "var(--ws-green)" }
        : value >= 25
          ? { label: "Caution" as const, color: amber }
          : { label: "Weak" as const, color: "var(--ws-red)" };
  const barFill =
    value == null
      ? undefined
      : value > 45
        ? "var(--ws-text)"
        : value >= 25
          ? amber
          : "var(--ws-red)";

  return (
    <div className="rounded-lg p-3" style={{ background: "var(--ws-bg)", border: "1px solid var(--ws-border)" }}>
      <div className="text-[10px] font-medium tracking-wide mb-2" style={{ color: "var(--ws-text-vdim)" }}>
        {label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div
            className="text-2xl font-bold font-mono tabular-nums"
            style={{ color: pctColor, lineHeight: 1 }}
          >
            {displayVal}
          </div>
          {status != null && (
            <div className="text-[10px] mt-1" style={{ color: status.color }}>
              {status.label}
            </div>
          )}
        </div>
        <Sparkline data={sparkData} color={color} />
      </div>
      {/* Progress bar */}
      {value != null && (
        <div className="mt-2.5 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div
            className="h-1 rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: barFill, opacity: 0.75 }}
          />
        </div>
      )}
    </div>
  );
}

export default function MarketBreadthRail({
  selectedSymbol = "SPY",
}: {
  selectedSymbol?: string;
}) {
  const [breadth, setBreadth] = useState<BreadthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const sym = selectedSymbol?.toUpperCase() ?? "SPY";
  // Russell 2000 breadth data is not currently in the database;
  // fall back to S&P 500 breadth as a general market proxy for IWM.
  // Nasdaq breadth may also have gaps — the UI shows "—" gracefully when data is null.
  const indexId = sym === "QQQ" ? "nasdaq" : "sp500";
  const indexLabel = indexId === "nasdaq" ? "Nasdaq" : "S&P 500";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/breadth?index=${indexId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setBreadth(d as BreadthResponse); })
      .catch(() => { if (!cancelled) setBreadth(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [indexId]);

  const pct50Data = useMemo(
    () => (breadth?.breadth ?? []).slice(-120).map((r) => r.pctAbove50d).filter((v): v is number => v != null),
    [breadth]
  );
  const pct200Data = useMemo(
    () => (breadth?.breadth ?? []).slice(-120).map((r) => r.pctAbove200d).filter((v): v is number => v != null),
    [breadth]
  );

  const current50 = pct50Data.length > 0 ? pct50Data[pct50Data.length - 1] : null;
  const current200 = pct200Data.length > 0 ? pct200Data[pct200Data.length - 1] : null;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-3 space-y-3" style={{ background: "var(--ws-bg2)" }}>
      {/* Title */}
      <div className="text-center">
        <div className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
          {indexLabel} Breadth
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--ws-text-vdim)" }}>
          Based on {selectedSymbol?.toUpperCase() || "SPY"}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <span className="text-[11px]" style={{ color: "var(--ws-text-vdim)" }}>Loading breadth…</span>
        </div>
      ) : (
        <>
          <BreadthMetric
            label="% Stocks above 50 SMA"
            value={current50}
            sparkData={pct50Data}
            color="#0ea5e9"
          />
          <BreadthMetric
            label="% Stocks above 200 SMA"
            value={current200}
            sparkData={pct200Data}
            color="#a78bfa"
          />
        </>
      )}
    </div>
  );
}
