"use client";
/* eslint-disable react-hooks/set-state-in-effect -- hydrate watchlists + settings from localStorage */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { getActiveProfile } from "@/lib/profile-storage";
import {
  consumeLargeCapRunStream,
  type LargeCapRunEvent,
} from "@/lib/premarket/large-cap-run-client";
import {
  loadLargeCapSettings,
  saveLargeCapSettings,
  type LargeCapDataMode,
  type LargeCapSettings,
} from "@/lib/premarket/large-cap-settings-storage";
import { sortLargeCapRows } from "@/lib/premarket/large-cap-row-sort";
import {
  buildNarrativeBlocks,
  formatDecisionLevelPrice,
  LC_KEY_LEVELS_GRID,
  LC_SECTION_HEADER_COLOR,
  type NarrativeBlock,
} from "@/lib/premarket/large-cap-narrative-display";
import {
  formatKeyLevelPrice,
  scenarioLevelParts,
  scenarioLetter,
  type KeyLevelDisplay,
} from "@/lib/premarket/large-cap-verdict-display";
import CompsSection from "./CompsSection";
import { ymdInEt } from "@/lib/et-ymd";
import {
  loadLargeCapSession,
  saveLargeCapSession,
  type LargeCapSessionRow,
} from "@/lib/premarket/large-cap-session-storage";
import { loadWatchlists, type Watchlist } from "@/lib/watchlist-storage";
import LargeCapArchivePanel from "./LargeCapArchivePanel";

type RowStatus = "pending" | "loading" | "done" | "error";

/** Fixed width for ticker / price cluster (must not depend on company name length). */
const LC_TICKER_PANEL_W = "9.5rem";
const LC_SCENARIOS_COL_W = "26rem";
const LC_SUBSECTION_HEADER_CLASS = "pm-section-label text-xs font-medium";
/** Shared height for ticker + bias header bar alignment across columns. */
const LC_ROW_HEADER_BAR_CLASS = "flex items-center min-h-7";
/** Field labels (Gap, Trigger, Average Range, etc.) */
const LC_FIELD_LABEL_COLOR = "#c5cdd9";
const LC_FIELD_LABEL_MUTED_COLOR = "#a8b2c0";
/** Numeric / price values — same brightness everywhere (comps, scenarios, key levels). */
const LC_VALUE_COLOR = "var(--text-primary)";

function FieldLabel({
  children,
  muted = false,
  className = "text-xs",
}: {
  children: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`font-medium ${className}`.trim()}
      style={{ color: muted ? LC_FIELD_LABEL_MUTED_COLOR : LC_FIELD_LABEL_COLOR }}
    >
      {children}
    </span>
  );
}

function FieldValue({
  children,
  className = "text-xs shrink-0",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`pm-mono font-medium ${className}`.trim()}
      style={{ color: LC_VALUE_COLOR, ...style }}
    >
      {children}
    </span>
  );
}

function confidenceStyle(conf: string): { color: string; bg: string; label: string } {
  const c = conf.trim().toLowerCase();
  if (c === "high") return { color: "#4ade80", bg: "rgba(74,222,128,0.15)", label: "High" };
  if (c === "medium" || c === "med") return { color: "#fbbf24", bg: "rgba(251,191,36,0.15)", label: "Med" };
  return { color: "var(--text-tertiary)", bg: "rgba(255,255,255,0.06)", label: "Low" };
}

function biasStyle(bias: string): { color: string } {
  const b = bias.trim();
  if (b === "Bullish") return { color: "#4ade80" };
  if (b === "Bearish") return { color: "#f87171" };
  return { color: "#fbbf24" };
}

function BiasLabel({ bias }: { bias: string }) {
  const biasUi = biasStyle(bias);
  return (
    <span className={`${LC_SUBSECTION_HEADER_CLASS} leading-none`} style={{ color: biasUi.color }}>
      {bias}
    </span>
  );
}

function directionStyle(direction: string): { color: string; bg: string; label: string } {
  const d = direction.trim().toLowerCase();
  if (d === "long") return { color: "#4ade80", bg: "rgba(74,222,128,0.18)", label: "LONG" };
  if (d === "short") return { color: "#f87171", bg: "rgba(248,113,113,0.18)", label: "SHORT" };
  return { color: "#fbbf24", bg: "rgba(251,191,36,0.15)", label: "EITHER" };
}

export type LargeCapRow = {
  ticker: string;
  status: RowStatus;
  stale?: boolean;
  error?: string;
  cache_hit?: boolean;
  analyzed_at?: string;
  digest?: Record<string, unknown>;
  verdict?: Record<string, unknown>;
};


function formatPrice(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatPct(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatVol(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function formatAnalyzedAtEt(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}

function applyRunEvent(rows: Map<string, LargeCapRow>, event: LargeCapRunEvent): void {
  if (event.type === "row_result" && event.ticker) {
    rows.set(event.ticker, {
      ticker: event.ticker,
      status: "done",
      stale: false,
      cache_hit: event.cache_hit,
      analyzed_at: event.analyzed_at,
      digest: event.digest,
      verdict: event.verdict,
    });
  } else if (event.type === "row_error" && event.ticker) {
    rows.set(event.ticker, {
      ticker: event.ticker,
      status: "error",
      stale: false,
      error: event.error,
    });
  }
}

function rowToSessionRow(row: LargeCapRow): LargeCapSessionRow | null {
  if (row.status !== "done" && row.status !== "error") return null;
  return {
    status: row.status,
    stale: row.stale,
    error: row.error,
    cache_hit: row.cache_hit,
    analyzed_at: row.analyzed_at,
    digest: row.digest,
    verdict: row.verdict,
  };
}

function sessionRowToLargeCapRow(ticker: string, row: LargeCapSessionRow): LargeCapRow {
  return { ticker, ...row };
}

function persistSession(
  profileId: string,
  settingsKey: string,
  tradingDateEt: string,
  rows: LargeCapRow[],
  lastRunAt: string | null
): void {
  const stored: Record<string, LargeCapSessionRow> = {};
  for (const row of rows) {
    const snap = rowToSessionRow(row);
    if (snap) stored[row.ticker] = snap;
  }
  saveLargeCapSession({
    version: 1,
    profileId,
    settingsKey,
    tradingDateEt,
    lastRunAt,
    rows: stored,
  });
}

export default function LargeCapAnalysisPanel() {
  const [settings, setSettings] = useState<LargeCapSettings>(() => loadLargeCapSettings());
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [rows, setRows] = useState<LargeCapRow[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [runSettingsKey, setRunSettingsKey] = useState<string | null>(null);
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(() => new Set());
  const [collapsedTickers, setCollapsedTickers] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const hydrateAttemptedRef = useRef<string | null>(null);
  const tradingDateEt = ymdInEt();

  const settingsKey = `${settings.selectedListId ?? ""}|${settings.dataMode}`;

  const selectedList = useMemo(
    () => lists.find((l) => l.id === settings.selectedListId) ?? null,
    [lists, settings.selectedListId]
  );

  const tickers = useMemo(
    () => (selectedList?.symbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean),
    [selectedList]
  );

  useEffect(() => {
    const refreshLists = () => setLists(loadWatchlists());
    refreshLists();
    window.addEventListener("stock-watchlists-changed", refreshLists);
    return () => window.removeEventListener("stock-watchlists-changed", refreshLists);
  }, []);

  useEffect(() => {
    if (tickers.length === 0) {
      setRows([]);
      return;
    }
    const profile = getActiveProfile();
    const session =
      profile?.id != null
        ? loadLargeCapSession(profile.id, settingsKey, tradingDateEt)
        : null;

    setRows((prev) => {
      const byTicker = new Map(prev.map((r) => [r.ticker, r]));
      return tickers.map((t) => {
        const cached = session?.rows[t];
        if (cached) return sessionRowToLargeCapRow(t, cached);
        return byTicker.get(t) ?? { ticker: t, status: "pending" };
      });
    });

    if (session?.lastRunAt) {
      setLastRunAt(session.lastRunAt);
      setRunSettingsKey(settingsKey);
    }
    setSelectedTickers(new Set());
    setCollapsedTickers(new Set());
  }, [tickers.join("|"), settingsKey, tradingDateEt]);

  useEffect(() => {
    if (runSettingsKey && runSettingsKey !== settingsKey) {
      setRows((prev) => prev.map((r) => (r.status === "done" ? { ...r, stale: true } : r)));
    }
  }, [settingsKey, runSettingsKey]);

  const patchSettings = useCallback((patch: Partial<LargeCapSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveLargeCapSettings(next);
      return next;
    });
  }, []);

  const runTickers = useCallback(
    async (symbols: string[], opts?: { forceRefresh?: boolean }) => {
      const profile = getActiveProfile();
      if (!profile?.id) {
        alert("Sign in with a profile to run Large Cap Analysis.");
        return;
      }
      if (symbols.length === 0) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      setRunSettingsKey(settingsKey);

      setRows((prev) => {
        const map = new Map(prev.map((r) => [r.ticker, r]));
        for (const sym of symbols) {
          map.set(sym, { ticker: sym, status: "loading", stale: false });
        }
        return sortLargeCapRows(Array.from(map.values()));
      });

      let completedAt: string | null = null;

      try {
        const res = await fetch("/api/large-cap/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile_id: profile.id,
            tickers: symbols,
            data_mode: settings.dataMode,
            force_refresh: opts?.forceRefresh ?? false,
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
        }

        await consumeLargeCapRunStream(res, (event) => {
          if (event.type === "row_result" || event.type === "row_error") {
            setRows((prev) => {
              const map = new Map(prev.map((r) => [r.ticker, r]));
              applyRunEvent(map, event);
              const next = sortLargeCapRows(Array.from(map.values()));
              persistSession(profile.id, settingsKey, tradingDateEt, next, completedAt);
              return next;
            });
          }
        });

        completedAt = new Date().toISOString();
        setLastRunAt(completedAt);
        setArchiveRefreshToken((t) => t + 1);
        setSelectedTickers((prev) => {
          const next = new Set(prev);
          for (const sym of symbols) next.delete(sym);
          return next;
        });
        setRows((prev) => {
          persistSession(profile.id, settingsKey, tradingDateEt, prev, completedAt);
          return prev;
        });
      } catch (e) {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.map((r) =>
            symbols.includes(r.ticker) && r.status === "loading"
              ? { ...r, status: "error", error: msg }
              : r
          )
        );
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          setRunning(false);
        }
      }
    },
    [settings.dataMode, settingsKey, tradingDateEt]
  );

  const hydrateFromServerCache = useCallback(async () => {
    const profile = getActiveProfile();
    if (!profile?.id || tickers.length === 0) return;

    try {
      const res = await fetch("/api/large-cap/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          tickers,
          data_mode: settings.dataMode,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        rows?: Array<{
          ticker: string;
          cache_hit?: boolean;
          analyzed_at?: string;
          digest?: Record<string, unknown>;
          verdict?: Record<string, unknown>;
        }>;
      };
      if (!res.ok || !json.ok || !Array.isArray(json.rows) || json.rows.length === 0) return;

      const hydratedAt = json.rows.reduce<string | null>((latest, row) => {
        if (!row.analyzed_at) return latest;
        if (!latest || row.analyzed_at > latest) return row.analyzed_at;
        return latest;
      }, null);

      setRows((prev) => {
        const map = new Map(prev.map((r) => [r.ticker, r]));
        for (const row of json.rows!) {
          if (!row.ticker) continue;
          map.set(row.ticker, {
            ticker: row.ticker,
            status: "done",
            stale: false,
            cache_hit: row.cache_hit ?? true,
            analyzed_at: row.analyzed_at,
            digest: row.digest,
            verdict: row.verdict,
          });
        }
        const next = sortLargeCapRows(Array.from(map.values()));
        persistSession(profile.id, settingsKey, tradingDateEt, next, hydratedAt);
        return next;
      });

      if (hydratedAt) {
        setLastRunAt(hydratedAt);
        setRunSettingsKey(settingsKey);
      }
    } catch {
      /* ignore background hydrate failures */
    }
  }, [settings.dataMode, settingsKey, tickers, tradingDateEt]);

  useEffect(() => {
    const profile = getActiveProfile();
    if (!profile?.id || tickers.length === 0) return;

    const attemptKey = `${profile.id}|${settingsKey}|${tickers.join("|")}|${tradingDateEt}`;
    if (hydrateAttemptedRef.current === attemptKey) return;

    const session = loadLargeCapSession(profile.id, settingsKey, tradingDateEt);
    const sessionComplete =
      session != null &&
      tickers.every((t) => session.rows[t]?.status === "done" || session.rows[t]?.status === "error");

    hydrateAttemptedRef.current = attemptKey;
    if (sessionComplete) return;

    void hydrateFromServerCache();
  }, [tickers.join("|"), settingsKey, tradingDateEt, hydrateFromServerCache]);

  const toggleTickerSelected = useCallback((sym: string) => {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }, []);

  const selectAllTickers = useCallback(() => {
    setSelectedTickers(new Set(tickers));
  }, [tickers]);

  const clearSelectedTickers = useCallback(() => {
    setSelectedTickers(new Set());
  }, []);

  const collapsibleTickers = useMemo(
    () => rows.filter((r) => r.status === "done" || r.status === "error").map((r) => r.ticker),
    [rows]
  );

  const anyRowExpanded = useMemo(
    () => collapsibleTickers.some((t) => !collapsedTickers.has(t)),
    [collapsibleTickers, collapsedTickers]
  );

  const toggleRowCollapsed = useCallback((sym: string) => {
    setCollapsedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }, []);

  const collapseAllRows = useCallback(() => {
    setCollapsedTickers(new Set(collapsibleTickers));
  }, [collapsibleTickers]);

  const expandAllRows = useCallback(() => {
    setCollapsedTickers(new Set());
  }, []);

  const runTargets = useMemo(() => {
    if (selectedTickers.size === 0) return tickers;
    return tickers.filter((t) => selectedTickers.has(t));
  }, [tickers, selectedTickers]);

  const sortedRows = useMemo(() => sortLargeCapRows(rows), [rows]);

  const pillRows = useMemo(
    () => sortedRows.filter((r) => r.status === "pending"),
    [sortedRows]
  );

  const collapsedRows = useMemo(
    () =>
      sortedRows.filter(
        (r) => (r.status === "done" || r.status === "error") && collapsedTickers.has(r.ticker)
      ),
    [sortedRows, collapsedTickers]
  );

  const expandedRows = useMemo(
    () =>
      sortedRows.filter(
        (r) =>
          r.status === "loading" ||
          ((r.status === "done" || r.status === "error") && !collapsedTickers.has(r.ticker))
      ),
    [sortedRows, collapsedTickers]
  );

  const onRunAll = () => void runTickers(runTargets);
  const onRefreshRow = (sym: string) => void runTickers([sym], { forceRefresh: true });

  const lastRunLabel = formatAnalyzedAtEt(lastRunAt ?? undefined);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border-default)" }}>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          <span className="pm-section-label" style={{ fontSize: "var(--ws-fs-label)" }}>
            List
          </span>
          <select
            className="pm-focus rounded border px-2 py-1 pm-mono text-sm"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            value={settings.selectedListId ?? ""}
            onChange={(e) => patchSettings({ selectedListId: e.target.value || null })}
          >
            <option value="">Select a list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.symbols.length})
              </option>
            ))}
          </select>
        </label>

        <div
          className="flex rounded border overflow-hidden"
          style={{ borderColor: "var(--border-default)" }}
          role="group"
          aria-label="Data mode"
        >
          {(
            [
              ["historical", "Historical only"],
              ["historical_premarket", "Historical + Pre-Market"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className="pm-focus px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                background: settings.dataMode === mode ? "rgba(59, 191, 207, 0.15)" : "var(--bg-elevated)",
                color: settings.dataMode === mode ? "var(--ws-cyan)" : "var(--text-secondary)",
              }}
              onClick={() => patchSettings({ dataMode: mode as LargeCapDataMode })}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="pm-focus rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--ws-cyan)", color: "#0a0a0a" }}
          disabled={running || runTargets.length === 0}
          onClick={onRunAll}
        >
          {running
            ? "Running…"
            : selectedTickers.size > 0
              ? `Run Selected (${selectedTickers.size})`
              : "Run All"}
        </button>

        {lastRunLabel ? (
          <span className="pm-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
            Last run {lastRunLabel} ET
          </span>
        ) : null}

        {collapsibleTickers.length > 0 ? (
          <button
            type="button"
            className="pm-focus rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[color:var(--bg-elevated)]"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            onClick={() => (anyRowExpanded ? collapseAllRows() : expandAllRows())}
          >
            {anyRowExpanded ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
      </div>

      {!selectedList ? (
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          Choose a list to analyze its symbols.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          This list has no symbols.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                className="pm-focus rounded"
                checked={tickers.length > 0 && selectedTickers.size === tickers.length}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selectedTickers.size > 0 && selectedTickers.size < tickers.length;
                  }
                }}
                onChange={(e) => {
                  if (e.target.checked) selectAllTickers();
                  else clearSelectedTickers();
                }}
              />
              <span>Select all</span>
            </label>
            {selectedTickers.size > 0 ? (
              <button type="button" className="pm-focus underline" onClick={clearSelectedTickers}>
                Clear selection
              </button>
            ) : (
              <span>Check symbols to run a subset, or use Run All.</span>
            )}
          </div>
          <ul className="space-y-2">
            {pillRows.length > 0 ? (
              <li className="list-none">
                <CollapsedTickerPillStrip
                  rows={pillRows}
                  selectedTickers={selectedTickers}
                  running={running}
                  onToggleSelect={toggleTickerSelected}
                />
              </li>
            ) : null}
            {collapsedRows.map((row) => (
              <LargeCapRowCard
                key={row.ticker}
                row={row}
                dataMode={settings.dataMode}
                selected={selectedTickers.has(row.ticker)}
                collapsed
                onToggleCollapsed={() => toggleRowCollapsed(row.ticker)}
                onToggleSelect={() => toggleTickerSelected(row.ticker)}
                onRefresh={() => onRefreshRow(row.ticker)}
                running={running}
              />
            ))}
            {expandedRows.map((row) => (
              <LargeCapRowCard
                key={row.ticker}
                row={row}
                dataMode={settings.dataMode}
                selected={selectedTickers.has(row.ticker)}
                collapsed={false}
                onToggleCollapsed={() => toggleRowCollapsed(row.ticker)}
                onToggleSelect={() => toggleTickerSelected(row.ticker)}
                onRefresh={() => onRefreshRow(row.ticker)}
                running={running}
              />
            ))}
          </ul>
        </>
      )}

      <LargeCapArchivePanel refreshToken={archiveRefreshToken} />
    </div>
  );
}

function CollapsedTickerPillStrip({
  rows,
  selectedTickers,
  running,
  onToggleSelect,
}: {
  rows: LargeCapRow[];
  selectedTickers: Set<string>;
  running: boolean;
  onToggleSelect: (ticker: string) => void;
}) {
  return (
    <div
      className="rounded border px-2 py-2"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)" }}
    >
      <div className="flex flex-wrap gap-1.5">
        {rows.map((row) => {
          const selected = selectedTickers.has(row.ticker);
          const pillClass = ["lc-ticker-pill", selected ? "lc-ticker-pill--selected" : ""]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={row.ticker} className={pillClass}>
              <span onClick={(e) => e.stopPropagation()}>
                <RowSelectCheckbox
                  ticker={row.ticker}
                  selected={selected}
                  onToggle={() => onToggleSelect(row.ticker)}
                  disabled={running}
                />
              </span>
              <button
                type="button"
                className="lc-ticker-pill-label pm-focus"
                title={`Select ${row.ticker} for analysis`}
                onClick={() => onToggleSelect(row.ticker)}
              >
                {row.ticker}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TickerPanelShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`shrink-0 border-b md:border-b-0 md:border-r p-3 space-y-2 box-border ${className}`.trim()}
      style={{
        borderColor: "var(--border-default)",
        width: LC_TICKER_PANEL_W,
        minWidth: LC_TICKER_PANEL_W,
        maxWidth: LC_TICKER_PANEL_W,
        flex: `0 0 ${LC_TICKER_PANEL_W}`,
      }}
    >
      {children}
    </div>
  );
}

function TickerRowHeader({
  ticker,
  selected,
  onToggleSelect,
  running,
  muted = false,
}: {
  ticker: string;
  selected: boolean;
  onToggleSelect: () => void;
  running?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`${LC_ROW_HEADER_BAR_CLASS} gap-2 min-w-0 w-full`}>
      <span className="shrink-0 flex items-center self-stretch" onClick={(e) => e.stopPropagation()}>
        <RowSelectCheckbox
          ticker={ticker}
          selected={selected}
          onToggle={onToggleSelect}
          disabled={running}
        />
      </span>
      <span
        className="pm-mono text-lg font-semibold leading-none flex items-center flex-1 min-w-0 truncate"
        style={{ color: muted ? "var(--text-secondary)" : "var(--text-primary)" }}
      >
        {ticker}
      </span>
    </div>
  );
}

function RowCollapseChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      className="inline-block text-[10px] shrink-0 leading-none transition-transform duration-150"
      style={{
        color: "var(--text-tertiary)",
        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
      }}
      aria-hidden
    >
      ▼
    </span>
  );
}

function formatLevelCell(level: KeyLevelDisplay | { role: string; source: string; price?: number; zone_low?: number; zone_high?: number }): string {
  if ("zone_low" in level && typeof level.zone_low === "number") {
    return formatDecisionLevelPrice(level);
  }
  return formatKeyLevelPrice(level as KeyLevelDisplay);
}

function NarrativeSectionsContent({ blocks }: { blocks: NarrativeBlock[] }) {
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {blocks.map((block) => (
        <div key={block.id}>
          <div
            className={`${LC_SUBSECTION_HEADER_CLASS} mb-0.5`}
            style={{ color: LC_SECTION_HEADER_COLOR }}
          >
            {block.title}
          </div>
          {block.kind === "text" ? (
            <p className="text-sm leading-snug" style={{ color: "var(--text-primary)" }}>
              {block.body}
            </p>
          ) : block.kind === "bullets" ? (
            <ul
              className="list-disc space-y-1 pl-4 text-sm leading-snug"
              style={{ color: "var(--text-primary)" }}
            >
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : block.kind === "comps" ? (
            <CompsSection comps={block.comps} />
          ) : (
            <div className="space-y-1">
              {block.levels.map((lvl, i) => (
                <div key={i} className={LC_KEY_LEVELS_GRID}>
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {lvl.role}
                  </span>
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {lvl.source}
                  </span>
                  <span className="pm-mono text-sm shrink-0" style={{ color: LC_VALUE_COLOR }}>
                    {formatLevelCell(lvl)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NoTradePill() {
  return (
    <span
      className="inline-block w-fit text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)" }}
    >
      No Trade
    </span>
  );
}

function RowAnalysisHeader({
  bias,
  isError,
  analyzedMeta,
  collapsed,
  expandable = true,
  onRefresh,
  running,
  refreshLabel = "Refresh",
}: {
  bias: string;
  isError?: boolean;
  analyzedMeta: ReactNode;
  collapsed?: boolean;
  expandable?: boolean;
  onRefresh: () => void;
  running: boolean;
  refreshLabel?: string;
}) {
  return (
    <div className={`${LC_ROW_HEADER_BAR_CLASS} flex-wrap gap-2 w-full min-w-0`}>
      {isError ? (
        <span className={`${LC_SUBSECTION_HEADER_CLASS} leading-none`} style={{ color: "#f87171" }}>
          Error
        </span>
      ) : (
        <BiasLabel bias={bias} />
      )}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {analyzedMeta}
        {expandable && collapsed != null ? <RowCollapseChevron collapsed={collapsed} /> : null}
        <button
          type="button"
          className="pm-focus text-xs underline"
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={running}
        >
          {refreshLabel}
        </button>
      </div>
    </div>
  );
}

function RowSelectCheckbox({
  ticker,
  selected,
  onToggle,
  disabled,
}: {
  ticker: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      className="pm-focus shrink-0 rounded size-4"
      aria-label={`Select ${ticker}`}
      checked={selected}
      disabled={disabled}
      onChange={onToggle}
    />
  );
}

function LargeCapRowCard({
  row,
  dataMode,
  selected,
  collapsed,
  onToggleCollapsed,
  onToggleSelect,
  onRefresh,
  running,
}: {
  row: LargeCapRow;
  dataMode: LargeCapDataMode;
  selected: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleSelect: () => void;
  onRefresh: () => void;
  running: boolean;
}) {
  const verdict = row.verdict;
  const digest = row.digest;
  const priorDay = (digest?.recent_price_structure as Record<string, unknown> | undefined)?.prior_day as
    | Record<string, unknown>
    | undefined;
  const pm = digest?.premarket as Record<string, unknown> | null | undefined;
  const isNoTrade = verdict?.verdict === "No Trade";
  const analyzedEt = formatAnalyzedAtEt(row.analyzed_at);
  const bias = String(verdict?.bias ?? "Neutral");
  const showPm = dataMode === "historical_premarket" && pm && pm.last_price != null;
  const gapPct = pm?.gap_pct_vs_prior_close;
  const gapColor =
    typeof gapPct === "number" && gapPct > 0 ? "#4ade80" : typeof gapPct === "number" && gapPct < 0 ? "#f87171" : undefined;

  const analyzedMeta = analyzedEt ? (
    <span className="pm-mono text-xs shrink-0" style={{ color: "var(--text-tertiary)" }}>
      Analyzed {analyzedEt} ET{row.stale ? " · stale" : ""}
      {row.cache_hit ? " · cache" : ""}
    </span>
  ) : null;

  const rowExpandable = row.status === "done" || row.status === "error";
  const rowToggleProps = rowExpandable
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-expanded": !collapsed,
        "aria-label": `${collapsed ? "Expand" : "Collapse"} ${row.ticker} analysis`,
        className: "cursor-pointer",
        onClick: onToggleCollapsed,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapsed();
          }
        },
      }
    : {};

  if (collapsed && (row.status === "done" || row.status === "error")) {
    return (
      <li
        className={`rounded border overflow-hidden ${rowToggleProps.className ?? ""}`.trim()}
        style={{
          borderColor: row.status === "error" ? "var(--border-danger, #f87171)" : "var(--border-default)",
          opacity: row.stale ? 0.85 : 1,
        }}
        role={rowToggleProps.role}
        tabIndex={rowToggleProps.tabIndex}
        aria-expanded={rowToggleProps["aria-expanded"]}
        aria-label={rowToggleProps["aria-label"]}
        onClick={rowToggleProps.onClick}
        onKeyDown={rowToggleProps.onKeyDown}
      >
        <div className="flex flex-col md:flex-row md:items-start min-w-0">
          <TickerPanelShell>
            <TickerRowHeader
              ticker={row.ticker}
              selected={selected}
              onToggleSelect={onToggleSelect}
              running={running}
              muted={isNoTrade}
            />
            {isNoTrade ? <NoTradePill /> : null}
          </TickerPanelShell>
          <div className="flex-1 min-w-0 p-3">
            <RowAnalysisHeader
              bias={bias}
              isError={row.status === "error"}
              analyzedMeta={analyzedMeta}
              collapsed={collapsed}
              onRefresh={onRefresh}
              running={running}
              refreshLabel={row.status === "error" ? "Retry" : "Refresh"}
            />
          </div>
        </div>
      </li>
    );
  }

  const tickerStatsGrid = (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pm-mono">
      <span style={{ color: "var(--text-secondary)" }}>Prev</span>
      <FieldValue className="text-xs">{formatPrice(priorDay?.close)}</FieldValue>
      <span style={{ color: "var(--text-secondary)" }}>PM</span>
      <FieldValue className="text-xs">{showPm ? formatPrice(pm?.last_price) : "—"}</FieldValue>
      <span style={{ color: "var(--text-secondary)" }}>PM vol</span>
      <FieldValue className="text-xs">{showPm ? formatVol(pm?.volume) : "—"}</FieldValue>
      <span style={{ color: "var(--text-secondary)" }}>Gap</span>
      <FieldValue className="text-xs" style={showPm && gapColor ? { color: gapColor } : undefined}>
        {showPm ? formatPct(gapPct) : "—"}
      </FieldValue>
    </div>
  );

  if (row.status === "loading") {
    return (
      <li
        className="rounded border overflow-hidden animate-pulse"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div className="flex flex-col md:flex-row md:items-start min-w-0">
          <TickerPanelShell>
            <TickerRowHeader
              ticker={row.ticker}
              selected={selected}
              onToggleSelect={onToggleSelect}
              running
              muted
            />
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>Analyzing…</span>
          </TickerPanelShell>
        </div>
      </li>
    );
  }

  if (row.status === "error") {
    return (
      <li
        className={`rounded border overflow-hidden ${rowToggleProps.className ?? ""}`.trim()}
        style={{ borderColor: "var(--border-danger, #f87171)" }}
        role={rowToggleProps.role}
        tabIndex={rowToggleProps.tabIndex}
        aria-expanded={rowToggleProps["aria-expanded"]}
        aria-label={rowToggleProps["aria-label"]}
        onClick={rowToggleProps.onClick}
        onKeyDown={rowToggleProps.onKeyDown}
      >
        <div className="flex flex-col md:flex-row md:items-start min-w-0">
          <TickerPanelShell>
            <TickerRowHeader
              ticker={row.ticker}
              selected={selected}
              onToggleSelect={onToggleSelect}
              running={running}
            />
            <span className="text-xs" style={{ color: "var(--text-danger, #f87171)" }}>
              {row.error ?? "Error"}
            </span>
          </TickerPanelShell>
          <div className="flex flex-1 items-center p-3">
            <RowAnalysisHeader
              bias={bias}
              isError
              analyzedMeta={analyzedMeta}
              collapsed={collapsed}
              onRefresh={onRefresh}
              running={running}
              refreshLabel="Retry"
            />
          </div>
        </div>
      </li>
    );
  }

  const narrativeBlocks = buildNarrativeBlocks(verdict, dataMode, digest);

  if (isNoTrade) {
    return (
      <li
        className={`rounded border overflow-hidden ${rowToggleProps.className ?? ""}`.trim()}
        style={{
          borderColor: "var(--border-default)",
          opacity: row.stale ? 0.55 : 1,
        }}
        role={rowToggleProps.role}
        tabIndex={rowToggleProps.tabIndex}
        aria-expanded={rowToggleProps["aria-expanded"]}
        aria-label={rowToggleProps["aria-label"]}
        onClick={rowToggleProps.onClick}
        onKeyDown={rowToggleProps.onKeyDown}
      >
        <div className="flex flex-col md:flex-row md:items-start min-w-0">
          <TickerPanelShell>
            <TickerRowHeader
              ticker={row.ticker}
              selected={selected}
              onToggleSelect={onToggleSelect}
              running={running}
              muted
            />
            <NoTradePill />
            {tickerStatsGrid}
          </TickerPanelShell>
          <div className="flex-1 min-w-0 p-3 space-y-2">
            <RowAnalysisHeader
              bias={bias}
              analyzedMeta={analyzedMeta}
              collapsed={collapsed}
              onRefresh={onRefresh}
              running={running}
            />
            <div onClick={(e) => e.stopPropagation()}>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                {(verdict?.verdict_reason as string) || ""}
              </p>
              {narrativeBlocks.length > 0 ? <NarrativeSectionsContent blocks={narrativeBlocks} /> : null}
            </div>
          </div>
        </div>
      </li>
    );
  }

  const scenarios = Array.isArray(verdict?.scenarios) ? (verdict.scenarios as Record<string, unknown>[]) : [];

  return (
    <li
      className={`rounded border overflow-hidden ${rowToggleProps.className ?? ""}`.trim()}
      style={{ borderColor: "var(--border-default)", opacity: row.stale ? 0.85 : 1 }}
      role={rowToggleProps.role}
      tabIndex={rowToggleProps.tabIndex}
      aria-expanded={rowToggleProps["aria-expanded"]}
      aria-label={rowToggleProps["aria-label"]}
      onClick={rowToggleProps.onClick}
      onKeyDown={rowToggleProps.onKeyDown}
    >
      <div className="flex flex-col md:flex-row md:items-start min-w-0">
        <TickerPanelShell>
          <TickerRowHeader
            ticker={row.ticker}
            selected={selected}
            onToggleSelect={onToggleSelect}
            running={running}
          />
          {tickerStatsGrid}
        </TickerPanelShell>

        <div className="flex-1 min-w-0 p-3 space-y-3">
          <RowAnalysisHeader
            bias={bias}
            analyzedMeta={analyzedMeta}
            collapsed={collapsed}
            onRefresh={onRefresh}
            running={running}
          />

          <div className="flex flex-col md:flex-row gap-4 min-w-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 min-w-0">
              <NarrativeSectionsContent blocks={narrativeBlocks} />
            </div>

            {scenarios.length > 0 ? (
              <div
                className="shrink-0 min-w-0"
                style={{ width: `min(100%, ${LC_SCENARIOS_COL_W})` }}
              >
                <div
                  className={`${LC_SUBSECTION_HEADER_CLASS} mb-1`}
                  style={{ color: LC_SECTION_HEADER_COLOR }}
                >
                  Scenarios
                </div>
                <ul className="space-y-3.5">
                  {scenarios.slice(0, 3).map((sc, i) => {
                    const letter = scenarioLetter(sc, i);
                    const conf = confidenceStyle(String(sc.confidence ?? "Low"));
                    const dir = directionStyle(String(sc.direction ?? "Either"));
                    const setup = String(sc.title ?? "");
                    return (
                      <li key={letter} className="flex gap-2">
                        <span
                          className="pm-mono w-4 shrink-0 text-xs font-semibold pt-0.5"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {letter}
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className="px-1.5 py-0.5 rounded font-semibold tracking-wide"
                              style={{ color: dir.color, background: dir.bg }}
                            >
                              {dir.label}
                            </span>
                            <span
                              className="px-1.5 py-0.5 rounded font-medium"
                              style={{ color: conf.color, background: conf.bg }}
                            >
                              {conf.label}
                            </span>
                          </div>
                          <p className="text-sm leading-snug" style={{ color: "var(--text-primary)" }}>
                            {setup}
                          </p>
                          <p className="pm-mono text-xs leading-snug">
                            {scenarioLevelParts(sc).map((part, pi) => (
                              <span key={part.label}>
                                {pi > 0 ? (
                                  <span style={{ color: "var(--text-tertiary)" }}> · </span>
                                ) : null}
                                <FieldLabel>{part.label} </FieldLabel>
                                <FieldValue>{part.value}</FieldValue>
                              </span>
                            ))}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
