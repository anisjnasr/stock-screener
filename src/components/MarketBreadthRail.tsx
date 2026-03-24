"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

type BreadthPoint = {
  date: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
};

type BreadthResponse = {
  breadth: BreadthPoint[];
};

function fmtDate(s: string): string {
  return s?.slice(5) ?? s;
}

function PctChart({ title, data, color }: { title: string; data: Array<{ date: string; value: number | null }>; color: string }) {
  const cleaned = data.filter((d) => d.value != null) as Array<{ date: string; value: number }>;
  const current = cleaned.length > 0 ? cleaned[cleaned.length - 1].value : null;

  return (
    <div className="rounded" style={{ border: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
      <div className="flex items-center justify-between px-2 pt-1.5 pb-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
          {title}
        </span>
        <span
          className="text-[10px] font-semibold tabular-nums"
          style={{ color: current != null && current >= 50 ? "var(--ws-green)" : "var(--ws-red)" }}
        >
          {current != null ? `${current.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="h-28 w-full px-1 pb-1">
        {cleaned.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>No data</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cleaned} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: "rgba(201,209,217,0.3)" }}
                minTickGap={30}
              />
              <YAxis
                orientation="right"
                domain={[0, 100]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: "rgba(201,209,217,0.3)" }}
                width={28}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                cursor={{ stroke: "rgba(148,163,184,0.3)", strokeWidth: 1 }}
                contentStyle={{ background: "#131820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, fontSize: 10 }}
                labelStyle={{ color: "rgba(201,209,217,0.5)" }}
                formatter={(v) => {
                  const n = typeof v === "number" ? v : Number(v ?? 0);
                  return [`${n.toFixed(1)}%`, ""];
                }}
                labelFormatter={(label) => String(label)}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} />
              <ReferenceLine y={50} stroke="rgba(201,209,217,0.15)" strokeWidth={1} strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function MarketBreadthRail() {
  const [symbol, setSymbol] = useState<"SPY" | "QQQ">("SPY");
  const [breadth, setBreadth] = useState<BreadthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const indexId = symbol === "SPY" ? "sp500" : "nasdaq";

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

  const pct50 = useMemo(
    () => (breadth?.breadth ?? []).map((r) => ({ date: r.date, value: r.pctAbove50d })).slice(-252),
    [breadth]
  );
  const pct200 = useMemo(
    () => (breadth?.breadth ?? []).map((r) => ({ date: r.date, value: r.pctAbove200d })).slice(-252),
    [breadth]
  );

  const indexLabel = symbol === "SPY" ? "S&P 500" : "Nasdaq";

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-2 space-y-2" style={{ background: "var(--ws-bg2)" }}>
      {/* SPY / QQQ toggle */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--ws-bg)" }}>
          {(["SPY", "QQQ"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors"
              style={{
                background: symbol === s ? "var(--ws-cyan)" : "transparent",
                color: symbol === s ? "var(--ws-bg)" : "var(--ws-text-dim)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <span className="text-[10px]" style={{ color: "var(--ws-text-vdim)" }}>Loading breadth…</span>
        </div>
      ) : (
        <>
          <PctChart title={`${indexLabel} % > 50 SMA`} data={pct50} color="#0ea5e9" />
          <PctChart title={`${indexLabel} % > 200 SMA`} data={pct200} color="#a78bfa" />
        </>
      )}
    </div>
  );
}
