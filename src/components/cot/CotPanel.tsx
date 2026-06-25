"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import type { CotResponse } from "@/lib/cot/contracts";
import CotChart, { type CotView } from "./CotChart";
import CotStatCards from "./CotStatCards";
import { formatReportDate } from "./format";

type RangeKey = "3M" | "1Y" | "3Y";
const RANGE_WEEKS: Record<RangeKey, number> = { "3M": 13, "1Y": 52, "3Y": 156 };
const RANGE_ORDER: RangeKey[] = ["3M", "1Y", "3Y"];
const VIEW_ORDER: { id: CotView; label: string }[] = [
  { id: "positioning", label: "Positioning" },
  { id: "index", label: "COT index" },
];

const STORAGE_KEY = "stockstalker-cot-panel-v1";

type PanelPrefs = {
  collapsed: boolean;
  contract: string;
  view: CotView;
  range: RangeKey;
};

const DEFAULT_PREFS: PanelPrefs = {
  collapsed: true,
  contract: "ES",
  view: "positioning",
  range: "1Y",
};

function loadPrefs(): PanelPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : DEFAULT_PREFS.collapsed,
      contract: typeof parsed.contract === "string" ? parsed.contract : DEFAULT_PREFS.contract,
      view: parsed.view === "index" || parsed.view === "positioning" ? parsed.view : DEFAULT_PREFS.view,
      range: parsed.range && RANGE_WEEKS[parsed.range] ? parsed.range : DEFAULT_PREFS.range,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: PanelPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / disabled storage */
  }
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-0.5 text-ws-caption font-medium transition-colors ws-focus-ring ${
        active ? "" : "hover:bg-white/[0.06]"
      }`}
      style={{
        background: active ? "var(--ws-cyan)" : undefined,
        color: active ? "var(--ws-bg)" : "var(--ws-text-dim)",
      }}
    >
      {children}
    </button>
  );
}

export default function CotPanel() {
  const [data, setData] = useState<CotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/cot")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CotResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<PanelPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  const contractKeys = useMemo(() => (data ? Object.keys(data) : []), [data]);
  const activeKey =
    data && data[prefs.contract] ? prefs.contract : contractKeys[0] ?? prefs.contract;
  const active = data ? data[activeKey] : undefined;

  const rangedSeries = useMemo(() => {
    if (!active) return [];
    const n = RANGE_WEEKS[prefs.range];
    return active.series.slice(-n);
  }, [active, prefs.range]);

  const prior = active && active.series.length >= 2 ? active.series[active.series.length - 2] : null;
  const reportWeek = active?.latest ? formatReportDate(active.latest.date) : null;

  return (
    <section
      className="sticky left-0 z-20 shrink-0"
      style={{
        width: "min(900px, 92vw)",
        background: "var(--ws-bg2)",
        borderBottom: "1px solid var(--ws-border)",
      }}
      aria-label="Commitments of Traders positioning"
    >
      {/* Header — entire bar toggles collapse */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!prefs.collapsed}
        className="flex cursor-pointer items-center gap-2 px-3 py-2 ws-focus-ring"
        onClick={() => update({ collapsed: !prefs.collapsed })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            update({ collapsed: !prefs.collapsed });
          }
        }}
      >
        <span className="text-ws-label font-semibold" style={{ color: "var(--ws-text)" }}>
          Commitments of traders
        </span>
        <span className="text-ws-caption hidden sm:inline" style={{ color: "var(--ws-text-vdim)" }}>
          — market positioning
        </span>
        <div className="flex-1" />
        {reportWeek && (
          <span className="text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            Week of {reportWeek}
          </span>
        )}
        <svg width="11" height="7" viewBox="0 0 10 6" fill="none" style={{ color: "var(--ws-text-dim)" }}>
          {prefs.collapsed ? (
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </div>

      {!prefs.collapsed && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <span className="text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
                Loading positioning…
              </span>
            </div>
          ) : error || !data || !active ? (
            <div className="flex h-24 items-center justify-center">
              <span className="text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
                {error ? `Could not load COT data (${error})` : "No COT data available"}
              </span>
            </div>
          ) : (
            <>
              {/* Asset switcher */}
              <div className="flex flex-wrap items-center gap-1">
                {contractKeys.map((key) => {
                  const c = data[key];
                  const isActive = key === activeKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => update({ contract: key })}
                      aria-pressed={isActive}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ws-caption font-medium transition-colors ws-focus-ring ${
                        isActive ? "" : "hover:bg-white/[0.06]"
                      }`}
                      style={
                        isActive
                          ? { background: "rgba(0,229,204,0.12)", border: "1px solid var(--ws-cyan)", color: "var(--ws-text)" }
                          : { background: "var(--ws-bg3)", border: "1px solid var(--ws-border)", color: "var(--ws-text-dim)" }
                      }
                    >
                      <span>{c.label}</span>
                      <span style={{ color: "var(--ws-text-vdim)" }}>{c.ticker}</span>
                    </button>
                  );
                })}
              </div>

              {/* Stat cards */}
              <CotStatCards latest={active.latest} prior={prior} />

              {/* Chart toggles */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--ws-bg)" }}>
                  {VIEW_ORDER.map((v) => (
                    <Pill key={v.id} active={prefs.view === v.id} onClick={() => update({ view: v.id })}>
                      {v.label}
                    </Pill>
                  ))}
                </div>
                <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--ws-bg)" }}>
                  {RANGE_ORDER.map((r) => (
                    <Pill key={r} active={prefs.range === r} onClick={() => update({ range: r })}>
                      {r}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Chart */}
              <div className="h-56 w-full" style={{ background: "var(--ws-bg)", borderRadius: 8, padding: "8px 4px" }}>
                <CotChart view={prefs.view} data={rangedSeries} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
