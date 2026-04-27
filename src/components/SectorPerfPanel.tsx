"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { SectorSubTab } from "@/components/WorkspaceHeader";
import type { MatrixPerfMap, MatrixRow, MatrixTfKey, SectorsMatrixPayload } from "@/app/api/sectors-industries/matrix-shared";
import { MATRIX_PERF_TF } from "@/app/api/sectors-industries/matrix-shared";
import { getCachedSectorsMatrix, prefetchSectorsMatrix } from "@/lib/sectors-matrix-prefetch";

const PERF_HEADER: Record<MatrixTfKey, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "3M",
  half_year: "6M",
  year: "Year",
  ytd: "YTD",
};

type SortKey = "ticker" | "name" | MatrixTfKey;
type SortDir = "asc" | "desc";

function toDisplayCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function defaultSortDir(key: SortKey): SortDir {
  return key === "ticker" || key === "name" ? "asc" : "desc";
}

function cmpStr(a: string, b: string, asc: boolean): number {
  const c = a.localeCompare(b, undefined, { sensitivity: "base" });
  return asc ? c : -c;
}

function cmpNum(a: number | null, b: number | null, asc: boolean): number {
  const aOk = a != null && Number.isFinite(a);
  const bOk = b != null && Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return asc ? a - b : b - a;
}

function compareMatrixRows(a: MatrixRow, b: MatrixRow, key: SortKey, asc: boolean): number {
  if (key === "ticker") return cmpStr(a.ticker, b.ticker, asc);
  if (key === "name") return cmpStr(a.name, b.name, asc);
  return cmpNum(a.perf[key], b.perf[key], asc);
}

/** Same pixel size for header sort chevrons and industry row expand control. */
const MATRIX_TABLE_CHEVRON_PX = 10;

function SortChevrons({ activeAsc, activeDesc }: { activeAsc: boolean; activeDesc: boolean }) {
  const dim = "var(--ws-text-vdim)";
  const hi = "var(--ws-text)";
  const chev = { fontSize: `${MATRIX_TABLE_CHEVRON_PX}px` } as const;
  return (
    <span className="ml-0.5 inline-flex shrink-0 flex-col items-center justify-center leading-[0.65]" aria-hidden>
      <span style={{ ...chev, color: activeAsc ? hi : dim }}>▲</span>
      <span style={{ ...chev, color: activeDesc ? hi : dim }}>▼</span>
    </span>
  );
}

function emptyPerfMap(): MatrixPerfMap {
  const o = {} as MatrixPerfMap;
  for (const tf of MATRIX_PERF_TF) o[tf] = null;
  return o;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function PerfCell({
  value,
  maxAbs,
}: {
  value: number | null;
  maxAbs: number;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span style={{ color: "var(--ws-text-vdim)" }}>—</span>;
  }
  const pct = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  /** Portion of the full cell width (0–50%) filled from the center axis. */
  const halfSpanPct = pct * 50;
  const textColor =
    value > 0 ? "var(--ws-green)" : value < 0 ? "var(--ws-red)" : "var(--ws-text-dim)";
  return (
    <div className="flex items-center gap-1 min-w-0 justify-end pr-0.5">
      <div className="relative h-4 w-[56px] max-w-[56px] shrink-0" aria-hidden>
        <div
          className="pointer-events-none absolute inset-y-1 left-1/2 z-[1] w-px -translate-x-1/2"
          style={{ background: "var(--ws-border)", opacity: 0.6 }}
        />
        {value > 0 && (
          <div
            className="absolute left-1/2 top-1/2 z-0 h-2 -translate-y-1/2 rounded-r-sm"
            style={{
              width: `${halfSpanPct}%`,
              minWidth: halfSpanPct > 0 ? 2 : 0,
              background: "var(--ws-green)",
              opacity: 0.75,
            }}
          />
        )}
        {value < 0 && (
          <div
            className="absolute right-1/2 top-1/2 z-0 h-2 -translate-y-1/2 rounded-l-sm"
            style={{
              width: `${halfSpanPct}%`,
              minWidth: halfSpanPct > 0 ? 2 : 0,
              background: "var(--ws-red)",
              opacity: 0.75,
            }}
          />
        )}
      </div>
      <span className="font-mono text-ws-body tabular-nums shrink-0" style={{ color: textColor, fontSize: "11px" }}>
        {fmtPct(value)}
      </span>
    </div>
  );
}

/** Shrink-to-fit label column in a full-width table (avoids stretching past longest truncated name). */
const NAME_COL_TH =
  "w-[1%] max-w-[min(11rem,32ch)] overflow-hidden text-ellipsis border-b px-1 py-1.5 text-left text-ws-label font-semibold whitespace-nowrap";
const NAME_COL_TD =
  "w-[1%] max-w-[min(11rem,32ch)] overflow-hidden text-ellipsis px-1 py-1 align-middle whitespace-nowrap";

function SortTh({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  colKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === colKey;
  const activeAsc = active && sortDir === "asc";
  const activeDesc = active && sortDir === "desc";
  const isName = colKey === "name";
  /** w-[1%] lets full-width tables keep these columns content-sized (avoids perf columns stretching apart). */
  const shrink = isName ? "" : "w-[1%]";
  const perfPad = align === "right" ? "px-0.5" : "px-1";
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={
        isName
          ? NAME_COL_TH
          : `${shrink} ${perfPad} py-1.5 text-ws-label font-semibold whitespace-nowrap border-b ${align === "right" ? "text-right" : "text-left"}`
      }
      style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
    >
      <button
        type="button"
        className="inline-flex items-center gap-0.5 max-w-full cursor-pointer ws-focus-ring rounded px-0.5"
        style={{ color: active ? "var(--ws-cyan)" : "var(--ws-text)" }}
        onClick={() => onSort(colKey)}
      >
        <span className="truncate">{label}</span>
        <SortChevrons activeAsc={activeAsc} activeDesc={activeDesc} />
      </button>
    </th>
  );
}

export default function SectorPerfPanel({
  subTab,
  onDrillDown,
  onSymbolSelect,
  onTickerActivate,
  headerActionsSlot,
  onRowCountChange,
}: {
  subTab: SectorSubTab;
  onDrillDown?: (kind: "sector" | "industry" | "theme" | "index", value: string) => void;
  /** Updates chart symbol only (row highlight). */
  onSymbolSelect?: (sym: string) => void;
  /** Opens Lists with ticker active (e.g. Market Monitor drill). */
  onTickerActivate?: (sym: string) => void;
  headerActionsSlot?: HTMLDivElement | null;
  onRowCountChange?: (display: string) => void;
}) {
  const [payload, setPayload] = useState<SectorsMatrixPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("day");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(() => new Set());
  const [childrenByEtf, setChildrenByEtf] = useState<Record<string, MatrixRow[]>>({});
  const [loadingEtf, setLoadingEtf] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const cached = getCachedSectorsMatrix();
    const p = cached
      ? Promise.resolve(cached)
      : prefetchSectorsMatrix().then((j) => j ?? null);
    p.then((json) => {
      if (cancelled) return;
      if (!json) {
        setError("Failed to load");
        setPayload(null);
        return;
      }
      setPayload(json);
    }).catch(() => {
      if (!cancelled) {
        setError("Failed to load");
        setPayload(null);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const parentRows: MatrixRow[] = useMemo(() => {
    if (!payload) return [];
    if (subTab === "sectors") return payload.sectors ?? [];
    return (payload.industries ?? []).map((x) => ({
      ...x,
      name: toDisplayCase(x.name),
    }));
  }, [payload, subTab]);

  const sortedParents = useMemo(() => {
    const list = [...parentRows];
    list.sort((a, b) => compareMatrixRows(a, b, sortKey, sortDir === "asc"));
    return list;
  }, [parentRows, sortKey, sortDir]);

  const onSortHeader = useCallback(
    (k: SortKey) => {
      if (sortKey === k) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(k);
        setSortDir(defaultSortDir(k));
      }
    },
    [sortKey]
  );

  const maxAbsByTf = useMemo(() => {
    const rowsForMax: MatrixRow[] = [...sortedParents];
    for (const t of expandedTickers) {
      const ch = childrenByEtf[t];
      if (ch) rowsForMax.push(...ch);
    }
    const m = {} as Record<MatrixTfKey, number>;
    for (const tf of MATRIX_PERF_TF) {
      m[tf] = Math.max(0.01, ...rowsForMax.map((r) => Math.abs(r.perf[tf] ?? 0)));
    }
    return m;
  }, [sortedParents, expandedTickers, childrenByEtf]);

  useEffect(() => {
    if (!onRowCountChange) return;
    onRowCountChange(loading ? "…" : String(sortedParents.length));
  }, [loading, sortedParents.length, onRowCountChange]);

  useEffect(() => {
    if (sortedParents.length === 0) {
      setSelectedTicker(null);
      return;
    }
    const first = sortedParents[0]?.ticker;
    if (first) {
      setSelectedTicker(first);
      onSymbolSelect?.(first);
    }
  }, [sortedParents, subTab, onSymbolSelect]);

  const toggleExpand = useCallback(
    async (etfTicker: string) => {
      if (subTab !== "industries") return;
      const next = new Set(expandedTickers);
      if (next.has(etfTicker)) {
        next.delete(etfTicker);
        setExpandedTickers(next);
        return;
      }
      next.add(etfTicker);
      setExpandedTickers(next);
      if (childrenByEtf[etfTicker]) return;
      setLoadingEtf(etfTicker);
      try {
        const r = await fetch(`/api/sectors-industries/constituents-matrix?etfTicker=${encodeURIComponent(etfTicker)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as { rows?: MatrixRow[]; error?: string };
        if (j.error) return;
        setChildrenByEtf((prev) => ({ ...prev, [etfTicker]: j.rows ?? [] }));
      } finally {
        setLoadingEtf(null);
      }
    },
    [subTab, expandedTickers, childrenByEtf]
  );

  const flatRows = useMemo(() => {
    type Flat = { kind: "parent" | "child"; row: MatrixRow; parentTicker?: string; indent?: boolean };
    const out: Flat[] = [];
    for (const row of sortedParents) {
      out.push({ kind: "parent", row });
      if (subTab === "industries" && expandedTickers.has(row.ticker)) {
        if (loadingEtf === row.ticker && !childrenByEtf[row.ticker]?.length) {
          out.push({
            kind: "child",
            row: {
              id: `loading-${row.ticker}`,
              name: "Loading…",
              ticker: "",
              drillKind: row.drillKind,
              drillValue: row.drillValue,
              perf: emptyPerfMap(),
            },
            indent: true,
          });
        }
        for (const c of childrenByEtf[row.ticker] ?? []) {
          out.push({ kind: "child", row: c, parentTicker: row.ticker, indent: true });
        }
      }
    }
    return out;
  }, [sortedParents, subTab, expandedTickers, childrenByEtf, loadingEtf]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-text-vdim)" }}>Loading…</span>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "var(--ws-bg2)" }}>
        <span className="text-xs" style={{ color: "var(--ws-red)" }}>{error ?? "No data"}</span>
      </div>
    );
  }

  const selectedRow = sortedParents.find((r) => r.ticker === selectedTicker) ?? sortedParents[0];

  return (
    <div className="h-full flex flex-col overflow-hidden min-w-0" style={{ background: "var(--ws-bg2)" }}>
      {headerActionsSlot && createPortal(
        <>
          {selectedRow && onDrillDown && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-ws-label cursor-pointer transition-colors shrink-0"
              style={{ color: "var(--ws-cyan)", background: "rgba(0,229,204,0.08)" }}
              title={`View ${selectedRow.ticker} constituents list`}
              onClick={() => {
                const kind = subTab === "sectors" ? "sector" : selectedRow.drillKind;
                onDrillDown(kind, selectedRow.drillValue);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5zm-3-8a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm0 4a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm0 4a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>
              List
            </button>
          )}
        </>,
        headerActionsSlot
      )}
      <div className="flex-1 min-h-0 overflow-auto w-full">
        <table className="w-full table-auto border-collapse text-xs min-w-[640px]">
          <thead>
            <tr style={{ background: "var(--ws-bg3)" }}>
              {subTab === "industries" ? (
                <th
                  scope="col"
                  className="w-9 min-w-[2.25rem] border-b p-0"
                  style={{ borderColor: "var(--ws-border)" }}
                  aria-label="Expand"
                />
              ) : null}
              <SortTh label="Ticker" colKey="ticker" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeader} />
              <SortTh label="Name" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeader} />
              {MATRIX_PERF_TF.map((tf) => (
                <SortTh
                  key={tf}
                  label={`Perf ${PERF_HEADER[tf]}`}
                  colKey={tf}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeader}
                  align="right"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {flatRows.map((fr) => {
              const { row, kind, indent } = fr;
              const isParent = kind === "parent";
              const isSel = isParent && row.ticker === selectedTicker;
              const pad = indent ? { paddingLeft: "1.5rem" } : undefined;
              const open = subTab === "industries" && isParent && expandedTickers.has(row.ticker);
              return (
                <tr
                  key={`${row.id}-${kind}-${row.ticker}`}
                  className="ws-row-hover border-b"
                  style={{
                    borderColor: "var(--ws-border)",
                    background: isSel ? "rgba(0,229,204,0.08)" : undefined,
                  }}
                  onClick={() => {
                    if (!row.ticker) return;
                    setSelectedTicker(row.ticker);
                    onSymbolSelect?.(row.ticker);
                  }}
                >
                  {subTab === "industries" ? (
                    <td className="w-9 min-w-[2.25rem] p-0 align-middle text-center" onClick={(e) => e.stopPropagation()}>
                      {isParent ? (
                        <button
                          type="button"
                          className="w-full min-h-8 flex items-center justify-center ws-focus-ring"
                          style={{ color: "var(--ws-text-dim)" }}
                          aria-expanded={open}
                          onClick={() => toggleExpand(row.ticker)}
                        >
                          <span
                            className="inline-block transition-transform leading-[0.65]"
                            style={{
                              fontSize: `${MATRIX_TABLE_CHEVRON_PX}px`,
                              color: "var(--ws-text-vdim)",
                              transform: open ? "rotate(180deg)" : "rotate(90deg)",
                            }}
                            aria-hidden
                          >
                            ▲
                          </span>
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="w-[1%] px-1 py-1 align-middle font-mono whitespace-nowrap" style={pad}>
                    {row.ticker ? (
                      <button
                        type="button"
                        className="text-left ws-focus-ring rounded px-0.5"
                        style={{ color: "var(--ws-cyan)", fontWeight: isSel ? 600 : 400 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTicker(row.ticker);
                          onSymbolSelect?.(row.ticker);
                          onTickerActivate?.(row.ticker);
                        }}
                      >
                        {row.ticker}
                      </button>
                    ) : (
                      <span style={{ color: "var(--ws-text-vdim)" }}>{row.name}</span>
                    )}
                  </td>
                  <td className={NAME_COL_TD} style={{ ...pad, color: "var(--ws-text)" }} title={row.name}>
                    {row.name}
                  </td>
                  {MATRIX_PERF_TF.map((tf) => (
                    <td key={tf} className="w-[1%] px-0 py-1 align-middle text-right whitespace-nowrap">
                      <PerfCell value={row.perf[tf]} maxAbs={maxAbsByTf[tf]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
