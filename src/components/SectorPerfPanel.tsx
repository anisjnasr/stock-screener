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

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
          {loading ? "…" : `${sorted.length} results`}
        </span>
      </div>
      <div ref={listRef} className="flex-1 overflow-auto">
        {sorted.map((s, i) => {
          const pct = s.changePct ?? 0;
          const isPos = pct >= 0;
          const barWidth = `${(Math.abs(pct) / maxAbs) * 100}%`;
          const isSelected = i === selectedIdx;
          return (
            <div
              key={s.id}
              className="flex items-center gap-2 px-3 py-[7px] cursor-pointer"
              style={{
                background: isSelected ? "rgba(0,229,204,0.08)" : "transparent",
                borderBottom: "1px solid var(--ws-border)",
              }}
              onClick={() => {
                setSelectedIdx(i);
                if (s.ticker) onSymbolSelect?.(s.ticker);
              }}
            >
              {s.ticker && (
                <span
                  className="shrink-0 font-mono text-xs leading-snug"
                  style={{
                    width: 52,
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? "#fff" : "var(--ws-text)",
                  }}
                >
                  {s.ticker}
                </span>
              )}
              <span
                className="text-[11px] leading-snug min-w-0 truncate"
                style={{
                  flex: "1 1 auto",
                  fontWeight: isSelected ? 500 : 400,
                  color: s.ticker ? "var(--ws-text-dim)" : (isSelected ? "#fff" : "var(--ws-text)"),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.name}
              </span>
              <div className="flex-1 flex items-center min-w-[72px] min-h-[6px]">
                <div
                  className="flex-1 flex justify-end items-center min-w-0 self-stretch border-r"
                  style={{ borderColor: "var(--ws-border)" }}
                >
                  {!isPos && (
                    <div
                      style={{
                        width: barWidth,
                        height: 6,
                        borderRadius: "3px 0 0 3px",
                        background: "var(--ws-red)",
                        opacity: 0.55,
                      }}
                    />
                  )}
                </div>
                <div className="flex-1 flex justify-start items-center min-w-0 self-stretch">
                  {isPos && (
                    <div
                      style={{
                        width: barWidth,
                        height: 6,
                        borderRadius: "0 3px 3px 0",
                        background: "var(--ws-green)",
                        opacity: 0.55,
                      }}
                    />
                  )}
                </div>
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
