"use client";

import { useEffect, useMemo, useState } from "react";
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

const TF_API: Record<SectorTimeframe, string> = {
  "1d": "day", "1w": "week", "1m": "month", "q": "quarter", "y": "year", "ytd": "day",
};

function toSentenceCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function SectorPerfPanel({
  subTab,
  timeframe,
  onDrillDown,
  onSymbolSelect,
}: {
  subTab: SectorSubTab;
  timeframe: SectorTimeframe;
  onDrillDown?: (kind: "sector" | "industry" | "theme" | "index", value: string) => void;
  onSymbolSelect?: (sym: string) => void;
}) {
  const [payload, setPayload] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

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
    if (subTab === "sectors") return (payload.sectors ?? []).map((x) => ({ id: x.id, name: x.name, changePct: x.changePct }));
    if (subTab === "industries") return (payload.industries ?? []).map((x) => ({ id: x.id, name: toSentenceCase(x.name), changePct: x.changePct }));
    if (subTab === "thematic") return (payload.themes ?? []).map((x) => ({ id: x.id, name: toSentenceCase(x.name), ticker: x.ticker, changePct: x.changePct }));
    return [];
  }, [payload, subTab]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)),
    [items]
  );

  const maxAbs = useMemo(
    () => Math.max(0.01, ...sorted.map((s) => Math.abs(s.changePct ?? 0))),
    [sorted]
  );

  useEffect(() => setSelectedIdx(0), [subTab, timeframe]);

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

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
          {loading ? "…" : `${sorted.length} results`}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        {sorted.map((s, i) => {
          const pct = s.changePct ?? 0;
          const isPos = pct >= 0;
          const barWidth = `${(Math.abs(pct) / maxAbs) * 100}%`;
          const isSelected = i === selectedIdx;
          return (
            <div
              key={s.id}
              className="flex items-center gap-1.5 px-3 py-[7px] cursor-pointer"
              style={{
                background: isSelected ? "rgba(0,229,204,0.08)" : "transparent",
                borderBottom: "1px solid var(--ws-border)",
              }}
              onClick={() => {
                setSelectedIdx(i);
                if (s.ticker) onSymbolSelect?.(s.ticker);
              }}
            >
              <span
                className="shrink-0 font-mono text-xs"
                style={{
                  width: 44,
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? "#fff" : "var(--ws-text)",
                }}
              >
                {s.ticker ?? s.id}
              </span>
              <span className="shrink-0 text-[10px] truncate" style={{ width: 80, color: "var(--ws-text-dim)" }}>
                {s.name}
              </span>
              <div className="flex-1 flex items-center" style={{ justifyContent: isPos ? "flex-start" : "flex-end" }}>
                <div
                  style={{
                    width: barWidth,
                    maxWidth: "80%",
                    height: 6,
                    borderRadius: 3,
                    background: isPos ? "var(--ws-green)" : "var(--ws-red)",
                    opacity: 0.5,
                  }}
                />
              </div>
              <span
                className="shrink-0 text-right font-mono text-[11px] tabular-nums"
                style={{ width: 52, color: isPos ? "var(--ws-green)" : "var(--ws-red)" }}
              >
                {isPos ? "+" : ""}{pct.toFixed(2)}%
              </span>
              <div
                className="shrink-0 flex items-center justify-center rounded text-[10px] cursor-pointer transition-opacity opacity-0 hover:opacity-100"
                style={{ width: 20, height: 20, color: "var(--ws-cyan)", background: "rgba(0,229,204,0.08)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  const kind = subTab === "sectors" ? "sector" : subTab === "industries" ? "industry" : "theme";
                  onDrillDown?.(kind, subTab === "thematic" ? s.id : s.name);
                }}
              >
                →
              </div>
            </div>
          );
        })}
      </div>
      <div className="shrink-0 px-3 py-1 text-center text-[10px]" style={{ color: "var(--ws-text-vdim)", borderTop: "1px solid var(--ws-border)" }}>
        Click row → chart · Hover → to drill into holdings
      </div>
    </div>
  );
}
