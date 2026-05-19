"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveProfile } from "@/lib/profile-storage";
import {
  ARCHIVE_OUTCOME_OPTIONS,
  archiveRowKey,
  compactScenarioLabel,
  computeForwardTestStats,
  filterArchiveRows,
  formatArchiveDate,
  formatPrice,
  resolveArchiveOutcome,
  scenarioHighlightRank,
  type LargeCapArchiveFilters,
  type LargeCapArchiveRow,
} from "@/lib/premarket/large-cap-archive";

type LargeCapArchivePanelProps = {
  refreshToken: number;
};

const EMPTY_FILTERS: LargeCapArchiveFilters = {
  ticker: "",
  dateFrom: "",
  dateTo: "",
  outcome: "",
};

export default function LargeCapArchivePanel({ refreshToken }: LargeCapArchivePanelProps) {
  const [rows, setRows] = useState<LargeCapArchiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LargeCapArchiveFilters>(EMPTY_FILTERS);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const loadArchive = useCallback(async () => {
    const profile = getActiveProfile();
    if (!profile?.id) {
      setRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/large-cap/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profile.id }),
      });
      const json = (await res.json()) as { ok?: boolean; rows?: LargeCapArchiveRow[]; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!collapsed) void loadArchive();
  }, [collapsed, refreshToken, loadArchive]);

  const filtered = useMemo(() => filterArchiveRows(rows, filters), [rows, filters]);
  const stats = useMemo(() => computeForwardTestStats(rows), [rows]);

  const patchFilter = (patch: Partial<LargeCapArchiveFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div
      className="rounded border mt-4"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-elevated)" }}
    >
      <button
        type="button"
        className="pm-focus flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span
          className="pm-mono inline-flex w-3 shrink-0 justify-center leading-none transition-transform duration-300"
          style={{ color: "var(--text-tertiary)", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ▼
        </span>
        <span className="pm-section-label text-xs" style={{ color: "var(--ws-cyan)" }}>
          Trade Archive
        </span>
        <span className="pm-mono text-xs ml-auto" style={{ color: "var(--text-tertiary)" }}>
          {rows.length} logged
        </span>
      </button>

      {!collapsed ? (
        <div className="border-t px-3 py-3 space-y-3" style={{ borderColor: "var(--border-default)" }}>
          {stats.resolved > 0 || stats.ambiguous > 0 ? (
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {stats.hitRatePct != null ? (
                <>
                  Of the last <strong>{stats.resolved}</strong> resolved Trade calls,{" "}
                  <strong>{stats.hitRatePct}%</strong> had a scenario play out.
                </>
              ) : null}
              {stats.ambiguous > 0 ? (
                <span style={{ color: "var(--text-tertiary)" }}>
                  {stats.hitRatePct != null ? " " : ""}
                  {stats.ambiguous} of {rows.length} calls unresolvable on daily data.
                </span>
              ) : null}
            </p>
          ) : rows.length === 0 && !loading ? (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              No Trade calls archived yet. Run analysis — Trade verdicts are logged here for forward testing.
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
              Ticker
              <input
                type="text"
                className="pm-focus rounded border px-2 py-1 pm-mono text-sm w-24 uppercase"
                style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)", color: "var(--text-primary)" }}
                value={filters.ticker}
                onChange={(e) => patchFilter({ ticker: e.target.value.toUpperCase() })}
                placeholder="All"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
              From
              <input
                type="date"
                className="pm-focus rounded border px-2 py-1 pm-mono text-sm"
                style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)", color: "var(--text-primary)" }}
                value={filters.dateFrom}
                onChange={(e) => patchFilter({ dateFrom: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
              To
              <input
                type="date"
                className="pm-focus rounded border px-2 py-1 pm-mono text-sm"
                style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)", color: "var(--text-primary)" }}
                value={filters.dateTo}
                onChange={(e) => patchFilter({ dateTo: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
              Outcome
              <select
                className="pm-focus rounded border px-2 py-1 text-sm"
                style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)", color: "var(--text-primary)" }}
                value={filters.outcome}
                onChange={(e) =>
                  patchFilter({ outcome: e.target.value as LargeCapArchiveFilters["outcome"] })
                }
              >
                {ARCHIVE_OUTCOME_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="pm-focus text-xs underline pb-1"
              style={{ color: "var(--text-secondary)" }}
              disabled={loading}
              onClick={() => void loadArchive()}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p className="text-sm" style={{ color: "var(--text-danger, #f87171)" }}>
              {error}
            </p>
          ) : null}

          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[36rem] grid-cols-[6.5rem_4rem_1fr_6.5rem] gap-x-2 gap-y-0 text-xs pm-section-label px-1 pb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                <span>Date</span>
                <span>Ticker</span>
                <span>Scenarios</span>
                <span>Outcome</span>
              </div>
              <ul className="space-y-0">
                {filtered.map((row) => {
                  const key = archiveRowKey(row);
                  const open = expandedKey === key;
                  const outcome = resolveArchiveOutcome(row);
                  const highlightRank = scenarioHighlightRank(outcome);
                  const scenarios = Array.isArray(row.result_json?.scenarios)
                    ? (row.result_json.scenarios as Record<string, unknown>[])
                    : [];
                  const scoringScenarios = Array.isArray(row.scoring_json?.scenarios)
                    ? (row.scoring_json.scenarios as Record<string, unknown>[])
                    : [];

                  return (
                    <li key={key} className="border-t" style={{ borderColor: "var(--border-default)" }}>
                      <button
                        type="button"
                        className="pm-focus grid w-full min-w-[36rem] grid-cols-[1.25rem_6.5rem_4rem_1fr_6.5rem] items-start gap-x-2 py-2 px-1 text-left hover:bg-[color:var(--bg-panel)]"
                        aria-expanded={open}
                        onClick={() => setExpandedKey((cur) => (cur === key ? null : key))}
                      >
                        <span
                          className="pm-mono inline-flex w-3 shrink-0 justify-center pt-0.5 leading-none transition-transform"
                          style={{
                            color: "var(--text-tertiary)",
                            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                          }}
                          aria-hidden
                        >
                          ▼
                        </span>
                        <span className="pm-mono tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                          {formatArchiveDate(row.trading_date)}
                        </span>
                        <span className="pm-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                          {row.ticker}
                        </span>
                        <span className="min-w-0 space-y-0.5">
                          {scenarios.length > 0 ? (
                            scenarios.slice(0, 3).map((sc, i) => {
                              const rank = typeof sc.rank === "number" ? sc.rank : i + 1;
                              const isWinner = highlightRank === rank;
                              const muted =
                                outcome === "None" ||
                                outcome === "Ambiguous" ||
                                (highlightRank != null && !isWinner);
                              return (
                                <span
                                  key={rank}
                                  className="block truncate text-xs leading-snug"
                                  style={{
                                    color: isWinner ? "var(--ws-cyan)" : muted ? "var(--text-tertiary)" : "var(--text-secondary)",
                                    fontWeight: isWinner ? 600 : 400,
                                    opacity: muted && !isWinner ? 0.65 : 1,
                                  }}
                                >
                                  {rank}. {compactScenarioLabel(sc)}
                                </span>
                              );
                            })
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>—</span>
                          )}
                        </span>
                        <OutcomeCell outcome={outcome} />
                      </button>
                      {open ? (
                        <ArchiveRowDetail
                          row={row}
                          scenarios={scenarios}
                          scoringScenarios={scoringScenarios}
                          highlightRank={highlightRank}
                          outcome={outcome}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : !loading && !error ? (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              No rows match the current filters.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OutcomeCell({ outcome }: { outcome: ReturnType<typeof resolveArchiveOutcome> }) {
  if (outcome === "Pending") {
    return (
      <span className="pm-mono text-xs italic" style={{ color: "var(--text-tertiary)" }}>
        Pending
      </span>
    );
  }
  if (outcome === "None") {
    return (
      <span className="pm-mono text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>
        None
      </span>
    );
  }
  if (outcome === "Ambiguous") {
    return (
      <span
        className="pm-mono text-xs font-medium cursor-help underline decoration-dotted"
        style={{ color: "var(--text-secondary)" }}
        title="Daily OHLC touched both target and invalidation — intraday sequence unknown, so no scenario can be confirmed."
      >
        Ambiguous
      </span>
    );
  }
  return (
    <span className="pm-mono text-xs font-semibold" style={{ color: "var(--ws-cyan)" }}>
      {outcome}
    </span>
  );
}

function ArchiveRowDetail({
  row,
  scenarios,
  scoringScenarios,
  highlightRank,
  outcome,
}: {
  row: LargeCapArchiveRow;
  scenarios: Record<string, unknown>[];
  scoringScenarios: Record<string, unknown>[];
  highlightRank: 1 | 2 | 3 | null;
  outcome: ReturnType<typeof resolveArchiveOutcome>;
}) {
  const narrative =
    typeof row.result_json?.narrative === "string" ? row.result_json.narrative : "";

  return (
    <div
      className="border-t px-3 pb-3 pt-2 space-y-3 text-sm"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)" }}
    >
      {narrative ? (
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {narrative}
        </p>
      ) : null}
      <ul className="space-y-2">
        {scenarios.map((sc, i) => {
          const rank = typeof sc.rank === "number" ? sc.rank : i + 1;
          const levels = (sc.key_levels ?? {}) as Record<string, unknown>;
          const score = scoringScenarios.find((s) => Number(s.rank) === rank);
          const isWinner = highlightRank === rank;
          const muted =
            outcome === "None" ||
            outcome === "Ambiguous" ||
            (highlightRank != null && !isWinner);

          return (
            <li
              key={rank}
              className="rounded border px-2 py-1.5 text-xs"
              style={{
                borderColor: isWinner ? "rgba(59,191,207,0.4)" : "var(--border-default)",
                opacity: muted && !isWinner ? 0.6 : 1,
              }}
            >
              <div className="font-semibold mb-0.5" style={{ color: isWinner ? "var(--ws-cyan)" : "var(--text-primary)" }}>
                Scenario {rank}: {String(sc.title ?? "")}
              </div>
              <p className="mb-1" style={{ color: "var(--text-secondary)" }}>
                {String(sc.description ?? "")}
              </p>
              <p className="pm-mono" style={{ color: "var(--text-tertiary)" }}>
                Trigger {formatPrice(levels.trigger)} → Target {formatPrice(levels.target)} / Inv{" "}
                {formatPrice(levels.invalidation)}
              </p>
              {score ? (
                <p className="pm-mono mt-1" style={{ color: "var(--text-tertiary)" }}>
                  Day bar: trigger {boolLabel(score.trigger_reached)} · target {boolLabel(score.target_reached)} ·
                  invalidation {boolLabel(score.invalidation_reached)}
                  {typeof score.classification === "string" ? ` (${score.classification.replace(/_/g, " ")})` : ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {row.outcome_scored_at ? (
        <p className="pm-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
          Scored {new Date(row.outcome_scored_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
        </p>
      ) : null}
    </div>
  );
}

function boolLabel(v: unknown): string {
  return v === true ? "✓" : "✗";
}
