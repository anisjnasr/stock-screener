"use client";

import type { CSSProperties } from "react";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { SipCatalyst } from "@/types/sip-catalyst";
import { formatScreenerCompact } from "@/components/premarket/premarket-number-display";
import { truncateSipRationale } from "@/lib/premarket/sip-rationale-truncate";
import { sipCatalystBadge } from "@/components/premarket/sip-badge-map";

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

const NEWS_SOURCE_LINE_MAX = 3;

const sourceLinkStyle: CSSProperties = {
  fontFamily: "var(--ws-font-sans)",
  fontSize: "var(--ws-fs-caption)",
};

function newsSourceLabel(it: PythonNewsItem): string {
  const pub = it.publisher?.trim();
  if (pub) return pub;
  const link = it.link?.trim();
  if (link) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, "");
      const seg = host.split(".")[0];
      if (seg) return seg.charAt(0).toUpperCase() + seg.slice(1);
    } catch {
      /* ignore */
    }
  }
  return "News";
}

function SourceNewsLinks({ items }: { items: PythonNewsItem[] }) {
  const slice = items.slice(0, NEWS_SOURCE_LINE_MAX);
  if (slice.length === 0) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
      {slice.map((it, i) => {
        const label = newsSourceLabel(it);
        const href = it.link?.trim();
        const title = it.title?.trim() || label;
        if (href) {
          return (
            <a
              key={`${href}-${i}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="pm-focus max-w-[14rem] shrink truncate font-normal text-[var(--text-faint)] no-underline underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline"
              style={sourceLinkStyle}
              title={title}
            >
              {label}
            </a>
          );
        }
        return (
          <span key={i} className="max-w-[14rem] shrink truncate font-normal text-[var(--text-faint)]" style={sourceLinkStyle} title={title}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

export type SipPlayRowsTableProps = {
  rows: GapperRow[];
  news: Record<string, PythonNewsItem[]> | null;
  catalyst: Record<string, SipCatalyst> | null;
  pythonConfigured: boolean;
  newsError?: string | null;
  catalystError?: string | null;
  onOpenTickerInLists?: (sym: string) => void;
  mode: "live" | "archive";
  /** Shown in footer when mode is archive (e.g. formatted UAE date). */
  archiveFooterNote?: string;
  /** Override empty-news copy for live rows with no headlines. */
  emptyNewsText?: string;
  /** Mid-large lists can grow past API cap when merging refreshes. */
  listMode?: "cumulative" | "capped";
  /** Reference cap for small-cap row display (live capped mode). */
  maxTickerDisplay?: number;
};

export default function SipPlayRowsTable({
  rows,
  news,
  catalyst,
  pythonConfigured,
  newsError,
  catalystError,
  onOpenTickerInLists,
  mode,
  archiveFooterNote,
  emptyNewsText,
  listMode = "capped",
  maxTickerDisplay = 10,
}: SipPlayRowsTableProps) {
  const n = rows.length;
  const displayError =
    (newsError ? `Headlines request failed: ${newsError}` : null) ??
    (catalystError ? `Catalyst generation failed: ${catalystError}` : null);
  const nowEt =
    mode === "live"
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date())
      : "";

  if (!rows.length) {
    return (
      <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
        No gappers for this snapshot.
      </p>
    );
  }

  return (
    <>
      {displayError ? (
        <div className="mb-2 rounded border px-3 py-2.5" role="alert" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
          <p className="pm-site-caption font-semibold" style={{ color: "var(--text-primary)" }}>
            Snapshot issues
          </p>
          <p className="pm-site-caption mt-1" style={{ color: "var(--text-secondary)" }}>
            {displayError}
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border-default)" }}>
        <div
          className="pm-sip-col-head grid min-w-[52rem] gap-x-2 gap-y-0 border-b px-2 py-1.5"
          style={{
            gridTemplateColumns: "4.5rem 4rem 5rem 5rem minmax(7rem,1.4fr) minmax(6rem,0.5fr)",
            borderColor: "var(--border-default)",
            background: "var(--bg-inset)",
            color: "var(--text-tertiary)",
          }}
        >
          <span>TKR</span>
          <span className="text-right">GAP%</span>
          <span className="text-right">MCAP</span>
          <span className="text-right">PM VOL</span>
          <span>CATALYST</span>
          <span>TYPE</span>
        </div>
        {rows.map((r) => {
          const cat = catalyst?.[r.ticker];
          const badge = cat ? sipCatalystBadge(cat) : null;
          const rowNews = news?.[r.ticker] ?? [];
          const showNewsEmpty = news !== null && pythonConfigured && !newsError && rowNews.length === 0;
          return (
            <div
              key={r.ticker}
              className="grid min-w-[52rem] items-start gap-x-2 gap-y-1 border-b px-2 py-1.5"
              style={{
                gridTemplateColumns: "4.5rem 4rem 5rem 5rem minmax(7rem,1.4fr) minmax(6rem,0.5fr)",
                borderColor: "var(--border-default)",
                background: "var(--bg-panel)",
              }}
            >
              <div className="pm-site-caption font-semibold" style={{ color: "var(--text-primary)" }}>
                {onOpenTickerInLists ? (
                  <button
                    type="button"
                    className="pm-focus rounded underline-offset-2 hover:underline"
                    style={{ color: "inherit", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                    onClick={() => onOpenTickerInLists(r.ticker)}
                  >
                    {r.ticker}
                  </button>
                ) : (
                  r.ticker
                )}
              </div>
              <div
                className="pm-mono text-right tabular-nums"
                style={{ color: r.gapPct >= 0 ? "var(--positive)" : "var(--negative)", fontSize: "var(--ws-fs-caption)" }}
              >
                {fmtPct(r.gapPct)}
              </div>
              <div className="pm-mono text-right tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--ws-fs-caption)" }}>
                {formatScreenerCompact(r.marketCap)}
              </div>
              <div className="pm-mono text-right tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--ws-fs-caption)" }}>
                {formatScreenerCompact(r.pmVolume)}
              </div>
              <div className="pm-site-caption min-w-0 leading-snug">
                {cat ? (
                  <p className="m-0" style={{ color: "#ffffff" }} title={cat.summary}>
                    {truncateSipRationale(cat.summary)}
                  </p>
                ) : showNewsEmpty ? null : (
                  <p className="m-0" style={{ color: "var(--text-secondary)" }}>
                    —
                  </p>
                )}
                {rowNews.length > 0 ? (
                  <SourceNewsLinks items={rowNews} />
                ) : showNewsEmpty ? (
                  <p
                    className={`pm-site-caption m-0 ${cat ? "mt-1" : ""}`}
                    style={{ color: "var(--text-faint)" }}
                  >
                    {emptyNewsText ?? "No headlines in window."}
                  </p>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {badge ? (
                  <span
                    className={`rounded px-1 py-px font-semibold uppercase ${badge.className}`}
                    style={{
                      fontFamily: "var(--ws-font-sans)",
                      fontSize: "var(--ws-fs-caption)",
                      letterSpacing: "var(--letter-tight)",
                    }}
                  >
                    {badge.label}
                  </span>
                ) : (
                  <span className="pm-site-caption" style={{ color: "var(--text-faint)" }}>
                    —
                  </span>
                )}
                {r.earningsRecent24h ? (
                  <span
                    className="rounded px-1 py-px uppercase"
                    style={{
                      fontFamily: "var(--ws-font-sans)",
                      fontSize: "var(--ws-fs-caption)",
                      border: "1px solid var(--accent-purple)",
                      color: "var(--accent-purple)",
                    }}
                  >
                    24h ER
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="pm-site-caption flex flex-wrap items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}
      >
        {mode === "live" ? (
          <span>
            {listMode === "cumulative"
              ? `${n} name${n === 1 ? "" : "s"} (accumulated) · updated ${nowEt} ET`
              : `${n} of ${maxTickerDisplay} max · updated ${nowEt} ET`}
          </span>
        ) : (
          <span>
            Archived SIP · {archiveFooterNote ?? "UAE date"} · {n} ticker{n === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </>
  );
}
