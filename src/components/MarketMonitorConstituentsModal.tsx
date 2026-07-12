"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketMonitorConstituentRow, MarketMonitorMetricKey } from "@/lib/screener-db-native";
import { loadWatchlists, saveWatchlists, type Watchlist } from "@/lib/watchlist-storage";

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

const WATCHLISTS_CHANGED = "stock-watchlists-changed";

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
  if (metric === "nnh52w_highs" || metric === "nnh52w_lows") return "Change % (1d)";
  if (metric === "universe_above_50d" || metric === "universe_above_200d") return "Change % (1d)";
  if (metric === "count_7x_atr_50d" || metric === "count_episodic_pivot") return "Change % (1d)";
  if (metric.includes("qtr")) return "Change % (Q)";
  if (metric.includes("month")) return "Change % (M)";
  return "Change %";
}

/** Matches workspace neutral controls */
const mmModalActionBtn =
  "font-medium rounded border border-[color:var(--ws-border)] bg-transparent text-[color:var(--ws-text)] transition-colors hover:bg-[var(--ws-hover)] hover:border-[color:var(--ws-border-hover)]";

function IndustryChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const [grouped, setGrouped] = useState(true);
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(() => new Set());
  const [rowChecked, setRowChecked] = useState<Set<string>>(() => new Set());
  const [lists, setLists] = useState<Watchlist[]>(() => (typeof window !== "undefined" ? loadWatchlists() : []));
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusWrapRef = useRef<HTMLDivElement>(null);

  const refreshLists = useCallback(() => {
    if (typeof window === "undefined") return;
    setLists(loadWatchlists());
  }, []);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(refreshLists);
    const onLists = () => refreshLists();
    window.addEventListener(WATCHLISTS_CHANGED, onLists);
    return () => window.removeEventListener(WATCHLISTS_CHANGED, onLists);
  }, [open, refreshLists]);

  useEffect(() => {
    if (!plusMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (plusWrapRef.current?.contains(t)) return;
      setPlusMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusMenuOpen]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setStocks([]);
      setExpandedIndustries(new Set());
      setRowChecked(new Set());
      setPlusMenuOpen(false);
    });
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

  const targetSymbolsUpper = useCallback((): string[] => {
    if (rowChecked.size > 0) {
      return [...rowChecked].map((s) => s.toUpperCase());
    }
    return stocks.map((s) => s.symbol.toUpperCase());
  }, [rowChecked, stocks]);

  const toggleRow = useCallback((sym: string) => {
    const u = sym.toUpperCase();
    setRowChecked((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  }, []);

  const toggleAllInRows = useCallback((rows: MarketMonitorConstituentRow[]) => {
    const syms = rows.map((r) => r.symbol.toUpperCase());
    setRowChecked((prev) => {
      const allOn = syms.length > 0 && syms.every((s) => prev.has(s));
      const next = new Set(prev);
      if (allOn) syms.forEach((s) => next.delete(s));
      else syms.forEach((s) => next.add(s));
      return next;
    });
  }, []);

  const toggleIndustry = useCallback((name: string) => {
    setExpandedIndustries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleNewList = useCallback(() => {
    const syms = [...new Set(targetSymbolsUpper().filter(Boolean))];
    if (syms.length === 0) return;
    const defaultName = `${indicatorTitle} (${date})`.slice(0, 200);
    const name =
      typeof window !== "undefined" ? window.prompt("New watchlist name", defaultName) : null;
    if (name == null || !name.trim()) return;
    const trimmed = name.trim().slice(0, 200);
    const existing = loadWatchlists();
    const id = crypto.randomUUID();
    const nextLists = [...existing, { id, name: trimmed, symbols: syms }];
    saveWatchlists(nextLists);
    setLists(nextLists);
    onListCreated?.({ id, name: trimmed, symbolCount: syms.length });
    setPlusMenuOpen(false);
  }, [date, indicatorTitle, onListCreated, targetSymbolsUpper]);

  const applySymbolsToList = useCallback((listId: string, shouldAdd: boolean) => {
    const syms = new Set(targetSymbolsUpper());
    if (syms.size === 0) return;
    const next = loadWatchlists().map((l) => {
      if (l.id !== listId) return l;
      if (shouldAdd) {
        const merged = [...l.symbols];
        for (const s of syms) {
          if (!merged.includes(s)) merged.push(s);
        }
        return { ...l, symbols: merged };
      }
      return { ...l, symbols: l.symbols.filter((s) => !syms.has(s)) };
    });
    saveWatchlists(next);
    setLists(next);
  }, [targetSymbolsUpper]);

  const handleTickerClick = useCallback(
    (sym: string) => {
      onSymbolSelect(sym);
      onClose();
    },
    [onSymbolSelect, onClose]
  );

  const chgHeader = changeColumnLabel(metric);

  const allPageSelected =
    stocks.length > 0 && stocks.every((s) => rowChecked.has(s.symbol.toUpperCase()));
  const somePageSelected = stocks.some((s) => rowChecked.has(s.symbol.toUpperCase()));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl max-h-[min(92vh,840px)] flex flex-col rounded-lg shadow-xl overflow-hidden border"
        style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }}
        role="dialog"
        aria-labelledby="mm-constituents-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 shrink-0 border-b"
          style={{ borderColor: "var(--ws-border)" }}
        >
          <h2 id="mm-constituents-title" className="text-base font-semibold truncate min-w-0" style={{ color: "var(--ws-text)" }}>
            {indicatorTitle}
            {!loading && !error ? ` (${stocks.length} stocks)` : ""}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" className={`text-xs px-3 py-1.5 ${mmModalActionBtn}`} onClick={() => setGrouped((g) => !g)}>
              {grouped ? "Ungroup" : "Group"}
            </button>
            <div className="relative" ref={plusWrapRef}>
              <button
                type="button"
                className={`inline-flex items-center justify-center w-9 h-9 text-lg leading-none rounded ${mmModalActionBtn} disabled:opacity-40 disabled:pointer-events-none`}
                disabled={loading || !!error || stocks.length === 0}
                aria-expanded={plusMenuOpen}
                aria-haspopup="true"
                title="Lists: new or add to existing"
                onClick={() => setPlusMenuOpen((v) => !v)}
              >
                +
              </button>
              {plusMenuOpen && !loading && !error && stocks.length > 0 && (
                <div
                  className="absolute right-0 top-full mt-1 z-[10000] min-w-[260px] max-w-[min(100vw-2rem,320px)] max-h-[min(50vh,360px)] overflow-auto rounded-lg py-1 shadow-lg"
                  style={{
                    background: "var(--ws-bg3, #1e2128)",
                    border: "1px solid var(--ws-border-hover, rgba(255,255,255,0.12))",
                  }}
                >
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--ws-hover)]"
                    style={{ color: "var(--ws-text)" }}
                    onClick={handleNewList}
                  >
                    New list…
                  </button>
                  <div
                    className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--ws-text-dim)" }}
                  >
                    Add to existing
                  </div>
                  {lists.length === 0 ? (
                    <p className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>
                      No saved lists yet.
                    </p>
                  ) : (
                    lists.map((l) => {
                      const syms = targetSymbolsUpper();
                      const allIn = syms.length > 0 && syms.every((s) => l.symbols.includes(s));
                      const someIn = syms.some((s) => l.symbols.includes(s));
                      return (
                        <label
                          key={l.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--ws-hover)]"
                          style={{ color: "var(--ws-text-dim)" }}
                        >
                          <input
                            type="checkbox"
                            className="accent-[var(--ws-cyan)] shrink-0"
                            ref={(el) => {
                              if (el) el.indeterminate = someIn && !allIn;
                            }}
                            checked={allIn}
                            onChange={() => applySymbolsToList(l.id, !allIn)}
                          />
                          <span className="truncate min-w-0">{l.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="p-1.5 rounded"
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

        <p className="px-4 py-1.5 text-[11px] shrink-0 border-b" style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}>
          {rowChecked.size > 0
            ? `${rowChecked.size} row(s) selected — list actions use the selection; empty selection uses all ${stocks.length} stocks.`
            : `No rows checked — list actions apply to all ${stocks.length} stocks.`}
        </p>

        <div className="flex-1 min-h-0 overflow-auto px-3 sm:px-4 py-3">
          {loading && (
            <p className="text-sm text-center py-10" style={{ color: "var(--ws-text-dim)" }}>
              Loading…
            </p>
          )}
          {error && (
            <p className="text-sm text-center py-10" style={{ color: "var(--ws-red)" }}>
              {error}
            </p>
          )}
          {!loading && !error && stocks.length === 0 && (
            <p className="text-sm text-center py-10" style={{ color: "var(--ws-text-dim)" }}>
              No stocks found.
            </p>
          )}
          {!loading && !error && stocks.length > 0 && !grouped && (
            <table className="w-full text-xs border-collapse text-left">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <th className="py-2 pr-1 w-8">
                    <input
                      type="checkbox"
                      className="accent-[var(--ws-cyan)]"
                      aria-label="Select all"
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      checked={allPageSelected}
                      onChange={() => toggleAllInRows(stocks)}
                    />
                  </th>
                  <th className="py-2 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                    Ticker
                  </th>
                  <th className="py-2 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                    Name
                  </th>
                  <th className="py-2 pr-2 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    Price
                  </th>
                  <th className="py-2 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    {chgHeader}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((row) => {
                  const u = row.symbol.toUpperCase();
                  return (
                    <tr key={row.symbol} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                      <td className="py-1.5 pr-1 align-middle">
                        <input
                          type="checkbox"
                          className="accent-[var(--ws-cyan)]"
                          checked={rowChecked.has(u)}
                          onChange={() => toggleRow(row.symbol)}
                          aria-label={`Select ${row.symbol}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          className="font-medium tabular-nums underline-offset-2 hover:underline"
                          style={{ color: "var(--ws-blue)" }}
                          onClick={() => handleTickerClick(row.symbol)}
                        >
                          {row.symbol}
                        </button>
                      </td>
                      <td className="py-1.5 pr-2 truncate max-w-[220px] sm:max-w-[280px]" style={{ color: "var(--ws-text)" }} title={row.name}>
                        {row.name || "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: "var(--ws-text)" }}>
                        {fmtPrice(row.price)}
                      </td>
                      <td
                        className="py-1.5 text-right tabular-nums font-medium"
                        style={{
                          color: row.changePct >= 0 ? "var(--ws-green)" : "var(--ws-red)",
                        }}
                      >
                        {fmtChg(row.changePct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && !error && stocks.length > 0 && grouped && (
            <div className="space-y-2">
              {industriesGrouped.map(([indName, rows]) => {
                const openRow = expandedIndustries.has(indName);
                const allInInd = rows.length > 0 && rows.every((r) => rowChecked.has(r.symbol.toUpperCase()));
                const someInInd = rows.some((r) => rowChecked.has(r.symbol.toUpperCase()));
                return (
                  <div key={indName} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--ws-border)" }}>
                    <div
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer"
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
                      <input
                        type="checkbox"
                        className="accent-[var(--ws-cyan)] shrink-0"
                        title="Select all in industry"
                        ref={(el) => {
                          if (el) el.indeterminate = someInInd && !allInInd;
                        }}
                        checked={allInInd}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleAllInRows(rows)}
                      />
                      <span className="w-4 shrink-0 flex items-center justify-center" style={{ color: "var(--ws-text-dim)" }}>
                        <IndustryChevron open={openRow} />
                      </span>
                      <span className="flex-1 text-xs font-semibold truncate" style={{ color: "var(--ws-text)" }}>
                        {indName}
                      </span>
                      <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--ws-text-dim)" }}>
                        {rows.length}
                      </span>
                    </div>
                    {openRow && (
                      <table className="w-full text-xs border-collapse text-left">
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
                            <th className="py-2 pl-3 pr-1 w-8" />
                            <th className="py-2 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                              Ticker
                            </th>
                            <th className="py-2 pr-2 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                              Name
                            </th>
                            <th className="py-2 pr-2 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                              Price
                            </th>
                            <th className="py-2 pr-3 font-semibold text-right tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                              {chgHeader}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => {
                            const u = row.symbol.toUpperCase();
                            return (
                              <tr key={row.symbol} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                                <td className="py-1.5 pl-3 pr-1">
                                  <input
                                    type="checkbox"
                                    className="accent-[var(--ws-cyan)]"
                                    checked={rowChecked.has(u)}
                                    onChange={() => toggleRow(row.symbol)}
                                    aria-label={`Select ${row.symbol}`}
                                  />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <button
                                    type="button"
                                    className="font-medium tabular-nums underline-offset-2 hover:underline"
                                    style={{ color: "var(--ws-blue)" }}
                                    onClick={() => handleTickerClick(row.symbol)}
                                  >
                                    {row.symbol}
                                  </button>
                                </td>
                                <td className="py-1.5 pr-2 truncate max-w-[200px] sm:max-w-[260px]" style={{ color: "var(--ws-text)" }} title={row.name}>
                                  {row.name || "—"}
                                </td>
                                <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: "var(--ws-text)" }}>
                                  {fmtPrice(row.price)}
                                </td>
                                <td
                                  className="py-1.5 pr-3 text-right tabular-nums font-medium"
                                  style={{
                                    color: row.changePct >= 0 ? "var(--ws-green)" : "var(--ws-red)",
                                  }}
                                >
                                  {fmtChg(row.changePct)}
                                </td>
                              </tr>
                            );
                          })}
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
