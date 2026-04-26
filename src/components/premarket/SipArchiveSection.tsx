"use client";
/* eslint-disable react-hooks/set-state-in-effect -- hydrate archive from localStorage + timers */

import { useCallback, useEffect, useId, useState } from "react";
import SipPlayRowsTable from "@/components/premarket/SipPlayRowsTable";
import {
  formatSipArchiveRowDate,
  loadSipArchiveEntries,
  msUntilNextDubaiMidnight,
  SIP_ARCHIVE_LS_KEY,
  tryAppendSipArchiveForCompletedUaeDay,
  type SipArchiveEntry,
} from "@/lib/premarket/sip-archive";

type SipArchiveSectionProps = {
  collapsed: boolean;
  onToggle: () => void;
  onOpenTickerInLists?: (sym: string) => void;
};

function joinTickers(tickers: string[]): string {
  return tickers.length ? tickers.join(" - ") : "—";
}

export default function SipArchiveSection({ collapsed, onToggle, onOpenTickerInLists }: SipArchiveSectionProps) {
  const uid = useId();
  const headerId = `premarket-header-sipArchive-${uid}`;
  const panelId = `premarket-panel-sipArchive-${uid}`;
  const [entries, setEntries] = useState<SipArchiveEntry[]>([]);
  const [expandedRowYmd, setExpandedRowYmd] = useState<string | null>(null);

  const refreshEntries = useCallback(() => {
    setEntries(loadSipArchiveEntries());
  }, []);

  const runArchivePass = useCallback(async () => {
    await tryAppendSipArchiveForCompletedUaeDay();
    refreshEntries();
  }, [refreshEntries]);

  useEffect(() => {
    refreshEntries();
    const onUpdated = () => refreshEntries();
    window.addEventListener("premarket-sip-archive-updated", onUpdated);
    return () => window.removeEventListener("premarket-sip-archive-updated", onUpdated);
  }, [refreshEntries]);

  useEffect(() => {
    void runArchivePass();
    const intervalId = window.setInterval(() => void runArchivePass(), 60_000);

    const scheduleMidnight = () => {
      const ms = msUntilNextDubaiMidnight(10);
      return window.setTimeout(() => {
        void runArchivePass();
        midnightId = scheduleMidnight();
      }, ms);
    };
    let midnightId = scheduleMidnight();

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(midnightId);
    };
  }, [runArchivePass]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIP_ARCHIVE_LS_KEY) refreshEntries();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshEntries]);

  const listMaxHeight = collapsed ? "min(9rem, 40vh)" : "min(24rem, 55vh)";

  return (
    <section
      data-premarket-section="sipArchive"
      className="min-w-0 rounded border transition-colors"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-panel)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        className="flex min-w-0 items-stretch gap-0 border-b"
        style={{ borderColor: "var(--border-default)" }}
      >
        <button
          type="button"
          id={headerId}
          role="button"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className="pm-focus flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--bg-elevated)]"
          style={{ color: "var(--text-primary)" }}
          onClick={onToggle}
        >
          <span
            className="pm-mono inline-flex w-3 shrink-0 justify-center leading-none transition-transform duration-300 ease-out"
            style={{
              fontSize: "var(--ws-fs-caption)",
              color: "var(--text-tertiary)",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            }}
            aria-hidden
          >
            ▼
          </span>
          <span className="pm-section-label shrink-0" style={{ color: "var(--ws-cyan)" }}>
            SIP ARCHIVE
          </span>
        </button>
      </div>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        className="border-t"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div
          className="overflow-y-auto px-3 py-2"
          style={{
            maxHeight: listMaxHeight,
            color: "var(--text-secondary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-caption)",
          }}
        >
          {entries.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-0">
              {entries.map((row) => {
                const open = expandedRowYmd === row.uaeYmd;
                const detail = row.detail;
                return (
                  <div
                    key={row.uaeYmd}
                    className="border-b border-[color:var(--border-default)] last:border-b-0"
                  >
                    <button
                      type="button"
                      className="pm-focus grid w-full min-w-0 grid-cols-[1.25rem_minmax(6.5rem,9rem)_1fr] items-baseline gap-x-2 gap-y-1 py-2 text-left transition-colors hover:bg-[color:var(--bg-elevated)] sm:grid-cols-[1.25rem_minmax(6.5rem,9rem)_1fr]"
                      style={{ color: "var(--text-primary)" }}
                      aria-expanded={open}
                      onClick={() => setExpandedRowYmd((cur) => (cur === row.uaeYmd ? null : row.uaeYmd))}
                    >
                      <span
                        className="pm-mono inline-flex w-3 shrink-0 justify-center leading-none transition-transform duration-300 ease-out"
                        style={{
                          fontSize: "var(--ws-fs-caption)",
                          color: "var(--text-tertiary)",
                          transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                        }}
                        aria-hidden
                      >
                        ▼
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {formatSipArchiveRowDate(row.uaeYmd)}
                      </span>
                      <span
                        className="min-w-0 truncate font-medium leading-snug sm:whitespace-normal sm:break-words"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {joinTickers(row.tickers)}
                      </span>
                    </button>
                    {open ? (
                      <div className="border-t px-1 pb-3 pt-2 sm:px-2" style={{ borderColor: "var(--border-default)" }}>
                        {detail?.rows?.length ? (
                          <SipPlayRowsTable
                            rows={detail.rows}
                            news={detail.news}
                            catalyst={detail.catalyst}
                            pythonConfigured={detail.pythonConfigured}
                            newsError={detail.newsError}
                            catalystError={detail.catalystError}
                            onOpenTickerInLists={onOpenTickerInLists}
                            mode="archive"
                            archiveFooterNote={formatSipArchiveRowDate(row.uaeYmd)}
                          />
                        ) : (
                          <div className="space-y-2">
                            <p className="pm-site-caption leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                              {row.tickers.length
                                ? "This day was stored without a full snapshot (older archive or missed capture). Tickers only:"
                                : "No tickers were archived for this day."}
                            </p>
                            {row.tickers.length > 0 ? (
                              <p className="pm-site-prose text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                                {joinTickers(row.tickers)}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : !collapsed ? (
            <p className="pm-site-caption leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              No archived days yet. After each midnight (UAE), the prior day&apos;s Stocks in Play tickers are saved
              here.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
