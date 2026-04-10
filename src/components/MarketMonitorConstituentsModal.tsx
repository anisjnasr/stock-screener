"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketMonitorConstituentRow, MarketMonitorMetricKey } from "@/lib/screener-db-native";
import { loadWatchlists, saveWatchlists } from "@/lib/watchlist-storage";

export type MarketMonitorListCreatedInfo = {
  id: string;
  name: string;
  symbolCount: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  date: string;
  metric: MarketMonitorMetricKey;
  indicatorTitle: string;
  onSymbolSelect: (sym: string) => void;
  onListCreated?: (info: MarketMonitorListCreatedInfo) => void;
};

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(2);
}

function fmtChg(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function changeColumnLabel(metric: MarketMonitorMetricKey): string {
  if (metric.includes("qtr")) return "Change % (Q)";
  if (metric.includes("month")) return "Change % (M)";
  return "Change %";
}

function createWatchlistWithName(name: string, symbols: string[]): MarketMonitorListCreatedInfo {
  const trimmed = name.slice(0, 200);
  const lists = loadWatchlists();
  const id = crypto.randomUUID();
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  saveWatchlists([...lists, { id, name: trimmed, symbols: uniq }]);
  return { id, name: trimmed, symbolCount: uniq.length };
}

/** Matches workspace neutral controls: dim border, text color, subtle lift on hover */
const mmModalActionBtn =
  "font-medium rounded border border-[color:var(--ws-border)] bg-transparent text-[color:var(--ws-text)] transition-colors hover:bg-[var(--ws-hover)] hover:border-[color:var(--ws-border-hover)]";

export default function MarketMonitorConstituentsModal({
  open,
  onClose,
  date,
  metric,
  indicatorTitle,
  onSymbolSelect,
  onListCreated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stocks, setStocks] = useState<MarketMonitorConstituentRow[]>([]);
  const [grouped, setGrouped] = useState(false);
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStocks([]);
    setExpandedIndustries(new Set());
    fetch(`/api/market-monitor/constituents?date=${encodeURIComponent(date)}&metric=${encodeURIComponent(metric)}`)
      .then((r) => r.json() as Promise<{ stocks?: MarketMonitorConstituentRow[]; error?: string }>)
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setStocks(json.stocks ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load constituents");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, date, metric]);

  const industriesGrouped = useMemo(() => {
    const map = new Map<string, MarketMonitorConstituentRow[]>();
    for (const s of stocks) {
      const key = s.industry?.trim() || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [stocks]);

  const toggleIndustry = useCallback((name: string) => {
    setExpandedIndustries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleCreateListAll = useCallback(() => {
    const result = createWatchlistWithName(
      indicatorTitle,
      stocks.map((s) => s.symbol)
    );
    onListCreated?.(result);
  }, [indicatorTitle, stocks, onListCreated]);

  const handleCreateListIndustry = useCallback(
    (industryName: string, rows: MarketMonitorConstituentRow[]) => {
      const label = `${industryName} - ${indicatorTitle}`;
      const result = createWatchlistWithName(
        label,
        rows.map((r) => r.symbol)
      );
      onListCreated?.(result);
    },
    [indicatorTitle, onListCreated]
  );

  const handleTickerClick = useCallback(
    (sym: string) => {
      onSymbolSelect(sym);
      onClose();
    },
    [onSymbolSelect, onClose]
  );

  const chgHeader = changeColumnLabel(metric);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[min(90vh,720px)] flex flex-col rounded-lg shadow-xl overflow-hidden border"
        style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }}
        role="dialog"
        aria-labelledby="mm-constituents-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-2 px-3 py-2.5 shrink-0 border-b"
          style={{ borderColor: "var(--ws-border)" }}
        >
          <h2 id="mm-constituents-title" className="text-sm font-semibold truncate min-w-0" style={{ color: "var(--ws-text)" }}>
            {indicatorTitle}
            {!loading && !error ? ` (${stocks.length} stocks)` : ""}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" className={`text-xs px-2 py-1 ${mmModalActionBtn}`} onClick={() => setGrouped((g) => !g)}>
              {grouped ? "Ungroup" : "Group"}
            </button>
            <button
              type="button"
              className={`text-xs px-2 py-1 ${mmModalActionBtn} disabled:opacity-40 disabled:pointer-events-none`}
              disabled={loading || !!error || stocks.length === 0}
              onClick={handleCreateListAll}
            >
              Create list
            </button>
            <button
              type="button"
              className="p-1 rounded"
              style={{ color: "var(--ws-text-dim)" }}
              aria-label="Close"
              onClick={onClose}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
          {loading && (
            <p className="text-sm text-center py-8" style={{ color: "var(--ws-text-dim)" }}>
              Loading…
            </p>
          )}
          {error && (
            <p className="text-sm text-center py-8" style={{ color: "var(--ws-red)" }}>
              {error}
            </p>
          )}
          {!loading && !error && stocks.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--ws-text-dim)" }}>
              No stocks found.
            </p>
          )}
          {!loading && !error && stocks.length > 0 && !grouped && (
            <table className="w-full text-xs border-collapse text-left">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <th className="py-1.5 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                    Ticker
                  </th>
                  <th className="py-1.5 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                    Name
                  </th>
                  <th className="py-1.5 pr-2 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    Price
                  </th>
                  <th className="py-1.5 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    {chgHeader}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((row) => (
                  <tr key={row.symbol} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                    <td className="py-1 pr-2">
                      <button
                        type="button"
                        className="font-medium tabular-nums underline-offset-2 hover:underline"
                        style={{ color: "var(--ws-blue)" }}
                        onClick={() => handleTickerClick(row.symbol)}
                      >
                        {row.symbol}
                      </button>
                    </td>
                    <td className="py-1 pr-2 truncate max-w-[200px]" style={{ color: "var(--ws-text)" }} title={row.name}>
                      {row.name || "—"}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums" style={{ color: "var(--ws-text)" }}>
                      {fmtPrice(row.price)}
                    </td>
                    <td
                      className="py-1 text-right tabular-nums font-medium"
                      style={{
                        color: row.changePct >= 0 ? "var(--ws-green)" : "var(--ws-red)",
                      }}
                    >
                      {fmtChg(row.changePct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && !error && stocks.length > 0 && grouped && (
            <div className="space-y-1">
              {industriesGrouped.map(([indName, rows]) => {
                const openRow = expandedIndustries.has(indName);
                return (
                  <div key={indName} className="rounded border" style={{ borderColor: "var(--ws-border)" }}>
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                      style={{ background: "var(--ws-bg2)" }}
                      onClick={() => toggleIndustry(indName)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleIndustry(indName);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="text-[10px] w-4" style={{ color: "var(--ws-text-dim)" }}>
                        {openRow ? "▼" : "▶"}
                      </span>
                      <span className="flex-1 text-xs font-medium truncate" style={{ color: "var(--ws-text)" }}>
                        {indName}
                      </span>
                      <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--ws-text-dim)" }}>
                        {rows.length}
                      </span>
                      <button
                        type="button"
                        className={`text-[10px] px-1.5 py-0.5 shrink-0 ${mmModalActionBtn}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateListIndustry(indName, rows);
                        }}
                      >
                        Create list
                      </button>
                    </div>
                    {openRow && (
                      <table className="w-full text-xs border-collapse text-left">
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                            <th className="py-1 pl-6 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                              Ticker
                            </th>
                            <th className="py-1.5 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                              Name
                            </th>
                            <th className="py-1.5 pr-2 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                              Price
                            </th>
                            <th className="py-1.5 pr-2 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                              {chgHeader}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.symbol} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                              <td className="py-1 pl-6 pr-2">
                                <button
                                  type="button"
                                  className="font-medium tabular-nums underline-offset-2 hover:underline"
                                  style={{ color: "var(--ws-blue)" }}
                                  onClick={() => handleTickerClick(row.symbol)}
                                >
                                  {row.symbol}
                                </button>
                              </td>
                              <td className="py-1 pr-2 truncate max-w-[180px]" style={{ color: "var(--ws-text)" }} title={row.name}>
                                {row.name || "—"}
                              </td>
                              <td className="py-1 pr-2 text-right tabular-nums" style={{ color: "var(--ws-text)" }}>
                                {fmtPrice(row.price)}
                              </td>
                              <td
                                className="py-1 pr-2 text-right tabular-nums font-medium"
                                style={{
                                  color: row.changePct >= 0 ? "var(--ws-green)" : "var(--ws-red)",
                                }}
                              >
                                {fmtChg(row.changePct)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
