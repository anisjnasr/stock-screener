"use client";
/* eslint-disable react-hooks/set-state-in-effect -- hydrate watchlists + settings from localStorage */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { loadWatchlists, type Watchlist } from "@/lib/watchlist-storage";
import LargeCapArchivePanel from "./LargeCapArchivePanel";

type RowStatus = "pending" | "loading" | "done" | "error";

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
  return n.toFixed(2);
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

export default function LargeCapAnalysisPanel() {
  const [settings, setSettings] = useState<LargeCapSettings>(() => loadLargeCapSettings());
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [rows, setRows] = useState<LargeCapRow[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [runSettingsKey, setRunSettingsKey] = useState<string | null>(null);
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

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
    setRows((prev) => {
      const byTicker = new Map(prev.map((r) => [r.ticker, r]));
      return tickers.map((t) => byTicker.get(t) ?? { ticker: t, status: "pending" });
    });
  }, [tickers.join("|")]);

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
              return sortLargeCapRows(Array.from(map.values()));
            });
          }
        });

        setLastRunAt(new Date().toISOString());
        setArchiveRefreshToken((t) => t + 1);
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
    [settings.dataMode, settingsKey]
  );

  const onRunAll = () => void runTickers(tickers);
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
          className="pm-focus rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--ws-cyan)", color: "#0a0a0a" }}
          disabled={running || tickers.length === 0}
          onClick={onRunAll}
        >
          {running ? "Running…" : "Run Analysis"}
        </button>

        {lastRunLabel ? (
          <span className="pm-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
            Last run {lastRunLabel} ET
          </span>
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
        <ul className="space-y-2">
          {sortLargeCapRows(rows).map((row) => (
            <LargeCapRowCard key={row.ticker} row={row} dataMode={settings.dataMode} onRefresh={() => onRefreshRow(row.ticker)} running={running} />
          ))}
        </ul>
      )}

      <LargeCapArchivePanel refreshToken={archiveRefreshToken} />
    </div>
  );
}

function LargeCapRowCard({
  row,
  dataMode,
  onRefresh,
  running,
}: {
  row: LargeCapRow;
  dataMode: LargeCapDataMode;
  onRefresh: () => void;
  running: boolean;
}) {
  const verdict = row.verdict;
  const digest = row.digest;
  const identity = (digest?.identity ?? {}) as Record<string, unknown>;
  const priorDay = (digest?.recent_price_structure as Record<string, unknown> | undefined)?.prior_day as
    | Record<string, unknown>
    | undefined;
  const pm = digest?.premarket as Record<string, unknown> | null | undefined;
  const isNoTrade = verdict?.verdict === "No Trade";
  const analyzedEt = formatAnalyzedAtEt(row.analyzed_at);
  const showPm = dataMode === "historical_premarket" && pm && pm.last_price != null;

  if (row.status === "pending") {
    return (
      <li className="rounded border px-3 py-2 pm-mono text-sm" style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}>
        {row.ticker} — not analyzed yet
      </li>
    );
  }

  if (row.status === "loading") {
    return (
      <li className="rounded border px-3 py-2 pm-mono text-sm animate-pulse" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
        {row.ticker} — analyzing…
      </li>
    );
  }

  if (row.status === "error") {
    return (
      <li className="rounded border px-3 py-2 flex items-center justify-between gap-2" style={{ borderColor: "var(--border-danger, #f87171)" }}>
        <span className="pm-mono text-sm" style={{ color: "var(--text-primary)" }}>
          {row.ticker} — {row.error ?? "Error"}
        </span>
        <button type="button" className="pm-focus text-xs underline" onClick={onRefresh} disabled={running}>
          Retry
        </button>
      </li>
    );
  }

  if (isNoTrade) {
    return (
      <li
        className="rounded border px-3 py-2 flex flex-wrap items-baseline gap-2"
        style={{
          borderColor: "var(--border-default)",
          opacity: row.stale ? 0.55 : 1,
        }}
      >
        <span className="pm-mono font-semibold" style={{ color: "var(--text-secondary)" }}>
          {row.ticker}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)" }}>
          No Trade
        </span>
        <span className="text-sm flex-1 min-w-[12rem]" style={{ color: "var(--text-tertiary)" }}>
          {(verdict?.verdict_reason as string) || (verdict?.narrative as string) || ""}
        </span>
        {analyzedEt ? (
          <span className="pm-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
            {analyzedEt} ET{row.stale ? " · stale" : ""}
          </span>
        ) : null}
        <button type="button" className="pm-focus text-xs underline" onClick={onRefresh} disabled={running}>
          Refresh
        </button>
      </li>
    );
  }

  const bias = String(verdict?.bias ?? "Neutral");
  const biasColor =
    bias === "Bullish" ? "#4ade80" : bias === "Bearish" ? "#f87171" : "var(--text-secondary)";
  const gapPct = pm?.gap_pct_vs_prior_close;
  const gapColor =
    typeof gapPct === "number" && gapPct > 0 ? "#4ade80" : typeof gapPct === "number" && gapPct < 0 ? "#f87171" : undefined;

  const scenarios = Array.isArray(verdict?.scenarios) ? (verdict.scenarios as Record<string, unknown>[]) : [];
  const letters = ["A", "B", "C"];

  return (
    <li
      className="rounded border overflow-hidden"
      style={{ borderColor: "var(--border-default)", opacity: row.stale ? 0.85 : 1 }}
    >
      <div className="flex flex-col md:flex-row min-w-0">
        <div
          className="shrink-0 border-b md:border-b-0 md:border-r p-3 space-y-2"
          style={{ borderColor: "var(--border-default)", minWidth: "9rem" }}
        >
          <div className="flex items-center gap-2">
            <span className="pm-mono text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {row.ticker}
            </span>
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(59,191,207,0.2)", color: "var(--ws-cyan)" }}>
              Trade
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {String(identity.company_name ?? "")}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pm-mono">
            <span style={{ color: "var(--text-tertiary)" }}>Prev</span>
            <span>{formatPrice(priorDay?.close)}</span>
            <span style={{ color: "var(--text-tertiary)" }}>PM</span>
            <span>{showPm ? formatPrice(pm?.last_price) : "—"}</span>
            <span style={{ color: "var(--text-tertiary)" }}>PM vol</span>
            <span>{showPm ? formatVol(pm?.volume) : "—"}</span>
            <span style={{ color: "var(--text-tertiary)" }}>Gap</span>
            <span style={{ color: showPm ? gapColor : undefined }}>{showPm ? formatPct(gapPct) : "—"}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: biasColor, fontWeight: 600 }}>
              {bias} {bias === "Bullish" ? "↑" : bias === "Bearish" ? "↓" : "→"}
            </span>
            {analyzedEt ? (
              <span className="pm-mono" style={{ color: "var(--text-tertiary)" }}>
                Analyzed {analyzedEt} ET{row.stale ? " · stale" : ""}
                {row.cache_hit ? " · cache" : ""}
              </span>
            ) : null}
            <button type="button" className="pm-focus ml-auto underline" onClick={onRefresh} disabled={running}>
              Refresh
            </button>
          </div>

          <div>
            <div className="pm-section-label text-xs mb-1" style={{ color: "var(--text-tertiary)" }}>
              Narrative
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {String(verdict?.narrative ?? "")}
            </p>
          </div>

          {scenarios.length > 0 ? (
            <div>
              <div className="pm-section-label text-xs mb-1" style={{ color: "var(--text-tertiary)" }}>
                Scenarios
              </div>
              <ul className="space-y-1.5">
                {scenarios.slice(0, 3).map((sc, i) => {
                  const conf = String(sc.confidence ?? "Med");
                  const confShort = conf === "Medium" ? "Med" : conf;
                  const levels = (sc.key_levels ?? {}) as Record<string, unknown>;
                  return (
                    <li key={i} className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      <span className="pm-mono font-semibold mr-1">{letters[i] ?? i + 1}</span>
                      <span className="text-xs mr-2 px-1 rounded" style={{ background: "rgba(255,255,255,0.06)" }}>
                        {confShort}
                      </span>
                      {String(sc.title ?? sc.description ?? "")}
                      <span className="pm-mono text-xs ml-1" style={{ color: "var(--text-tertiary)" }}>
                        @ {formatPrice(levels.trigger)} → {formatPrice(levels.target)} / inv {formatPrice(levels.invalidation)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
