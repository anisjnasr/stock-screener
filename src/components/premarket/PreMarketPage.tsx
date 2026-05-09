"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import EarningsCalendar from "./EarningsCalendar";
import EconomicCalendar from "./EconomicCalendar";
import DailyThemesPanel from "./DailyThemesPanel";
import PremarketGappers from "./PremarketGappers";
import StocksInPlay from "./StocksInPlay";
import SipArchiveSection from "./SipArchiveSection";
import { usePremarketLayout } from "./usePremarketLayout";
import type { PremarketSectionId } from "./premarket-layout-storage";
import {
  DEFAULT_GAPPER_FILTER_STATE,
  loadGapperFiltersFromStorage,
  type GapperFilterState,
} from "@/components/premarket/gapper-filters-storage";
import { ymdInEt } from "@/lib/et-ymd";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { SipCatalyst } from "@/types/sip-catalyst";
import type { CuratedSipAddPayload } from "@/types/stocks-in-play";
import { loadSipDaySnapshot, saveSipDaySnapshot, type SipPersistVariant } from "@/lib/premarket/sip-daily-persistence";

const SECTION_ORDER: PremarketSectionId[] = ["context", "sip", "movers", "calendars", "earnings", "sipArchive"];

type SectionConfig = {
  id: PremarketSectionId;
  label: string;
  labelAccent?: "cyan" | "amber" | "default";
  stub: string;
};

const SECTIONS: SectionConfig[] = [
  { id: "context", label: "THEMES", labelAccent: "cyan", stub: "" },
  { id: "sip", label: "Stocks in Play", labelAccent: "cyan", stub: "" },
  { id: "movers", label: "Gap Scanner", labelAccent: "cyan", stub: "" },
  { id: "calendars", label: "Economic & key events", labelAccent: "cyan", stub: "" },
  { id: "earnings", label: "Earnings", labelAccent: "cyan", stub: "" },
  { id: "sipArchive", label: "SIP ARCHIVE", labelAccent: "cyan", stub: "" },
];

type PreMarketPageProps = {
  onOpenTickerInLists?: (sym: string) => void;
};

type ManualPremarketRefreshResponse = {
  ok: boolean;
  elapsedMs?: number;
  newsletter?: {
    inserted?: number;
    examined?: number;
  };
  themes?: {
    themeCount?: number;
  };
  error?: string;
};

const OPERATOR_SECRET_SESSION_KEY = "premarket.adminSecret";

function formatElapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function PreMarketPage({ onOpenTickerInLists }: PreMarketPageProps) {
  const { collapsed, toggle, setCollapsed, collapseAll, expandAll } = usePremarketLayout();

  const [gapperFilters, setGapperFilters] = useState<GapperFilterState>(DEFAULT_GAPPER_FILTER_STATE);
  const [gapperFiltersHydrated, setGapperFiltersHydrated] = useState(false);
  const [sipLargeRows, setSipLargeRows] = useState<GapperRow[]>([]);
  const [sipSmallRows, setSipSmallRows] = useState<GapperRow[]>([]);
  const [sipNewsByTicker, setSipNewsByTicker] = useState<Record<string, PythonNewsItem[]>>({});
  const [sipCatalystByTicker, setSipCatalystByTicker] = useState<Record<string, SipCatalyst>>({});
  const [themesRefreshToken, setThemesRefreshToken] = useState(0);
  const [themesRefreshBusy, setThemesRefreshBusy] = useState(false);
  const [themesRefreshMessage, setThemesRefreshMessage] = useState<string | null>(null);
  const [themesRefreshElapsedMs, setThemesRefreshElapsedMs] = useState(0);
  const [themesRefreshStartedAtMs, setThemesRefreshStartedAtMs] = useState<number | null>(null);
  const [hasStoredAdminSecret, setHasStoredAdminSecret] = useState(false);

  useLayoutEffect(() => {
    queueMicrotask(() => {
      setGapperFilters(loadGapperFiltersFromStorage());
      setGapperFiltersHydrated(true);
    });
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(OPERATOR_SECRET_SESSION_KEY)?.trim() ?? "";
    setHasStoredAdminSecret(Boolean(stored));
  }, []);

  useLayoutEffect(() => {
    queueMicrotask(() => {
      const etYmd = ymdInEt();
      const large = loadSipDaySnapshot(etYmd, "mid-large");
      const small = loadSipDaySnapshot(etYmd, "small-cap");
      setSipLargeRows(large?.rows ?? []);
      setSipSmallRows(small?.rows ?? []);
      setSipNewsByTicker({ ...(large?.news ?? {}), ...(small?.news ?? {}) });
      setSipCatalystByTicker({ ...(large?.catalyst ?? {}), ...(small?.catalyst ?? {}) });
    });
  }, []);

  const sipMembershipByTicker = useMemo(() => {
    const map: Record<string, { large: boolean; small: boolean }> = {};
    for (const row of sipLargeRows) {
      const t = row.ticker.toUpperCase();
      map[t] = { ...(map[t] ?? { large: false, small: false }), large: true };
    }
    for (const row of sipSmallRows) {
      const t = row.ticker.toUpperCase();
      map[t] = { ...(map[t] ?? { large: false, small: false }), small: true };
    }
    return map;
  }, [sipLargeRows, sipSmallRows]);

  const addToSip = useCallback(
    ({ row, headlines, catalyst, target }: CuratedSipAddPayload) => {
      const ticker = row.ticker.toUpperCase();
      if (target === "mid-large") {
        setSipLargeRows((prev) => [row, ...prev.filter((r) => r.ticker.toUpperCase() !== ticker)]);
      } else {
        setSipSmallRows((prev) => [row, ...prev.filter((r) => r.ticker.toUpperCase() !== ticker)]);
      }
      if (headlines.length > 0) {
        setSipNewsByTicker((prev) => ({ ...prev, [ticker]: headlines }));
      }
      if (catalyst) {
        setSipCatalystByTicker((prev) => ({ ...prev, [ticker]: catalyst }));
      }
    },
    []
  );

  const upsertSipCatalyst = useCallback((ticker: string, detail: SipCatalyst) => {
    const t = ticker.toUpperCase();
    setSipCatalystByTicker((prev) => ({ ...prev, [t]: detail }));
  }, []);

  const removeFromSip = useCallback((target: SipPersistVariant, ticker: string) => {
    const t = ticker.toUpperCase();
    if (target === "mid-large") {
      setSipLargeRows((prev) => prev.filter((r) => r.ticker.toUpperCase() !== t));
      return;
    }
    setSipSmallRows((prev) => prev.filter((r) => r.ticker.toUpperCase() !== t));
  }, []);

  useEffect(() => {
    const etYmd = ymdInEt();
    const pickNews = (rows: GapperRow[]) => {
      const out: Record<string, PythonNewsItem[]> = {};
      for (const row of rows) {
        const t = row.ticker.toUpperCase();
        const news = sipNewsByTicker[t];
        if (news?.length) out[t] = news;
      }
      return out;
    };
    const pickCatalyst = (rows: GapperRow[]) => {
      const out: Record<string, SipCatalyst> = {};
      for (const row of rows) {
        const t = row.ticker.toUpperCase();
        const c = sipCatalystByTicker[t];
        if (c) out[t] = c;
      }
      return out;
    };
    saveSipDaySnapshot(
      {
        v: 1,
        etYmd,
        savedAtMs: Date.now(),
        rows: sipLargeRows,
        news: pickNews(sipLargeRows),
        catalyst: pickCatalyst(sipLargeRows),
        newsError: null,
        catalystError: null,
        pythonConfigured: true,
      },
      "mid-large"
    );
    saveSipDaySnapshot(
      {
        v: 1,
        etYmd,
        savedAtMs: Date.now(),
        rows: sipSmallRows,
        news: pickNews(sipSmallRows),
        catalyst: pickCatalyst(sipSmallRows),
        newsError: null,
        catalystError: null,
        pythonConfigured: true,
      },
      "small-cap"
    );
  }, [sipCatalystByTicker, sipLargeRows, sipNewsByTicker, sipSmallRows]);

  const anySectionExpanded = useMemo(() => SECTION_ORDER.some((id) => !collapsed[id]), [collapsed]);

  useEffect(() => {
    if (!themesRefreshBusy || themesRefreshStartedAtMs == null) return;
    const id = window.setInterval(() => {
      setThemesRefreshElapsedMs(Date.now() - themesRefreshStartedAtMs);
    }, 250);
    return () => window.clearInterval(id);
  }, [themesRefreshBusy, themesRefreshStartedAtMs]);

  const runManualPremarketRefresh = useCallback(async (adminSecret: string): Promise<ManualPremarketRefreshResponse> => {
    const res = await fetch("/api/admin/premarket-refresh", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${adminSecret}`,
      },
    });
    const json = (await res.json().catch(() => ({ ok: false, error: res.statusText }))) as ManualPremarketRefreshResponse;
    if (!res.ok) return { ok: false, error: json.error ?? res.statusText };
    return json;
  }, []);

  const clearStoredAdminSecret = useCallback(() => {
    sessionStorage.removeItem(OPERATOR_SECRET_SESSION_KEY);
    setHasStoredAdminSecret(false);
    setThemesRefreshMessage("Cleared stored ADMIN_SECRET for this tab.");
  }, []);

  const triggerThemesRefresh = useCallback(async () => {
    if (themesRefreshBusy) return;
    const startedAtMs = Date.now();
    setThemesRefreshStartedAtMs(startedAtMs);
    setThemesRefreshElapsedMs(0);
    setThemesRefreshBusy(true);
    setThemesRefreshMessage("Running newsletter ingest and theme generation...");
    try {
      let adminSecret = sessionStorage.getItem(OPERATOR_SECRET_SESSION_KEY)?.trim() ?? "";
      if (!adminSecret) {
        const entered = window.prompt("Enter ADMIN_SECRET to run manual pre-market refresh:");
        adminSecret = entered?.trim() ?? "";
        if (!adminSecret) {
          setThemesRefreshMessage("Manual pre-market refresh cancelled.");
          return;
        }
        sessionStorage.setItem(OPERATOR_SECRET_SESSION_KEY, adminSecret);
        setHasStoredAdminSecret(true);
      }

      let result = await runManualPremarketRefresh(adminSecret);
      if (!result.ok) {
        if ((result.error ?? "").toLowerCase().includes("unauthorized")) {
          sessionStorage.removeItem(OPERATOR_SECRET_SESSION_KEY);
          setHasStoredAdminSecret(false);
          const entered = window.prompt("ADMIN_SECRET was rejected. Re-enter ADMIN_SECRET:");
          const retrySecret = entered?.trim() ?? "";
          if (!retrySecret) {
            setThemesRefreshMessage("Manual pre-market refresh cancelled.");
            return;
          }
          sessionStorage.setItem(OPERATOR_SECRET_SESSION_KEY, retrySecret);
          setHasStoredAdminSecret(true);
          result = await runManualPremarketRefresh(retrySecret);
        }
      }

      if (!result.ok) {
        setThemesRefreshMessage(result.error ?? "Pre-market refresh failed.");
        return;
      }

      const elapsedMs = result.elapsedMs ?? Date.now() - startedAtMs;
      setThemesRefreshMessage(
        `Refresh complete in ${formatElapsedLabel(elapsedMs)} (${result.newsletter?.inserted ?? 0} inserted, ${result.themes?.themeCount ?? 0} themes).`
      );
      setThemesRefreshElapsedMs(elapsedMs);
      setThemesRefreshToken((v) => v + 1);
    } catch (e) {
      setThemesRefreshMessage(e instanceof Error ? e.message : "Manual pre-market refresh failed.");
    } finally {
      setThemesRefreshBusy(false);
      setThemesRefreshStartedAtMs(null);
    }
  }, [runManualPremarketRefresh, themesRefreshBusy]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {SECTIONS.map((s) =>
          s.id === "sip" ? (
            <StocksInPlay
              key={s.id}
              sectionLabel={s.label}
              collapsed={collapsed.sip}
              onToggle={() => toggle("sip")}
              onOpenTickerInLists={onOpenTickerInLists}
              largeRows={sipLargeRows}
              smallRows={sipSmallRows}
              newsByTicker={sipNewsByTicker}
              catalystByTicker={sipCatalystByTicker}
              onUpsertCatalyst={upsertSipCatalyst}
              onRemoveFromSip={removeFromSip}
            />
          ) : s.id === "sipArchive" ? (
            <SipArchiveSection
              key={s.id}
              collapsed={collapsed.sipArchive}
              onToggle={() => toggle("sipArchive")}
              onOpenTickerInLists={onOpenTickerInLists}
            />
          ) : (
          <CollapsibleSection
            key={s.id}
            id={s.id}
            label={s.label}
            labelAccent={s.labelAccent}
            collapsed={collapsed[s.id]}
            onToggle={() => toggle(s.id)}
            actions={
              s.id === "context" ? (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void triggerThemesRefresh()}
                      disabled={themesRefreshBusy}
                      className="pm-focus shrink-0 cursor-pointer rounded border px-2.5 py-1 font-medium transition-colors hover:bg-[color:var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-70"
                      style={{
                        borderColor: "var(--border-default)",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--ws-font-sans)",
                        fontSize: "var(--ws-fs-label)",
                      }}
                      aria-label="Run newsletter ingest and refresh themes"
                    >
                      {themesRefreshBusy ? "Running..." : "Refresh"}
                    </button>
                    <span className="pm-site-caption pm-mono tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      {formatElapsedLabel(themesRefreshElapsedMs)}
                    </span>
                    {hasStoredAdminSecret ? (
                      <button
                        type="button"
                        onClick={clearStoredAdminSecret}
                        className="pm-focus shrink-0 cursor-pointer rounded border px-2 py-1 font-medium transition-colors hover:bg-[color:var(--bg-elevated)]"
                        style={{
                          borderColor: "var(--border-default)",
                          color: "var(--text-secondary)",
                          fontFamily: "var(--ws-font-sans)",
                          fontSize: "var(--ws-fs-label)",
                        }}
                        aria-label="Clear stored admin key"
                      >
                        Clear key
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => (anySectionExpanded ? collapseAll() : expandAll())}
                      className="pm-focus shrink-0 cursor-pointer rounded border px-2.5 py-1 font-medium transition-colors hover:bg-[color:var(--bg-elevated)]"
                      style={{
                        borderColor: "var(--border-default)",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--ws-font-sans)",
                        fontSize: "var(--ws-fs-label)",
                      }}
                      aria-label={anySectionExpanded ? "Collapse all pre-market sections" : "Expand all pre-market sections"}
                    >
                      {anySectionExpanded ? "Collapse all" : "Expand all"}
                    </button>
                  </div>
                  {themesRefreshMessage ? (
                    <span className="pm-site-caption text-right" style={{ color: "var(--text-tertiary)" }}>
                      {themesRefreshMessage}
                    </span>
                  ) : null}
                </div>
              ) : undefined
            }
          >
            {s.id === "calendars" ? (
              <EconomicCalendar />
            ) : s.id === "earnings" ? (
              <EarningsCalendar onOpenTickerInLists={onOpenTickerInLists} />
            ) : s.id === "movers" ? (
              <div className="space-y-3">
                <PremarketGappers
                  filters={gapperFilters}
                  setFilters={setGapperFilters}
                  filtersHydrated={gapperFiltersHydrated}
                  onOpenTickerInLists={onOpenTickerInLists}
                  sipMembershipByTicker={sipMembershipByTicker}
                  onAddToSip={(target, payload) =>
                    addToSip({ ...payload, target })
                  }
                  onJumpToEarnings={() => {
                    setCollapsed("earnings", false);
                    queueMicrotask(() => {
                      document.querySelector('[data-premarket-section="earnings"]')?.scrollIntoView({
                        behavior: "smooth",
                        block: "nearest",
                      });
                    });
                  }}
                />
              </div>
            ) : s.id === "context" ? (
              <DailyThemesPanel refreshToken={themesRefreshToken} />
            ) : (
              <p className="max-w-prose leading-relaxed">{s.stub}</p>
            )}
          </CollapsibleSection>
          )
        )}
      </div>
    </div>
  );
}
