"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import EarningsCalendar from "./EarningsCalendar";
import DailyThemesPanel from "./DailyThemesPanel";
import LargeCapAnalysisPanel from "./LargeCapAnalysisPanel";
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
import { loadSipDaySnapshot, saveSipDaySnapshot, buildLiveSipSnapshot, type SipPersistVariant } from "@/lib/premarket/sip-daily-persistence";
import { getActiveProfile, syncPremarketSipBundle } from "@/lib/profile-storage";

const SECTION_ORDER: PremarketSectionId[] = ["context", "largeCap", "sip", "movers", "earnings", "sipArchive"];

type SectionConfig = {
  id: PremarketSectionId;
  label: string;
  labelAccent?: "cyan" | "amber" | "default";
  stub: string;
};

const SECTIONS: SectionConfig[] = [
  { id: "context", label: "THEMES", labelAccent: "cyan", stub: "" },
  { id: "largeCap", label: "Large Cap Analysis", labelAccent: "cyan", stub: "" },
  { id: "sip", label: "Stocks in Play", labelAccent: "cyan", stub: "" },
  { id: "movers", label: "Gap Scanner", labelAccent: "cyan", stub: "" },
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
  const [themesRefreshElapsedMs, setThemesRefreshElapsedMs] = useState(0);
  const [themesRefreshStartedAtMs, setThemesRefreshStartedAtMs] = useState<number | null>(null);
  const [themesRefreshError, setThemesRefreshError] = useState<string | null>(null);

  useLayoutEffect(() => {
    queueMicrotask(() => {
      setGapperFilters(loadGapperFiltersFromStorage());
      setGapperFiltersHydrated(true);
    });
  }, []);

  const hydrateSipStateFromStorage = useCallback(() => {
    const etYmd = ymdInEt();
    const large = loadSipDaySnapshot(etYmd, "mid-large");
    const small = loadSipDaySnapshot(etYmd, "small-cap");
    setSipLargeRows(large?.rows ?? []);
    setSipSmallRows(small?.rows ?? []);
    setSipNewsByTicker({ ...(large?.news ?? {}), ...(small?.news ?? {}) });
    setSipCatalystByTicker({ ...(large?.catalyst ?? {}), ...(small?.catalyst ?? {}) });
  }, []);

  useLayoutEffect(() => {
    queueMicrotask(() => hydrateSipStateFromStorage());
  }, [hydrateSipStateFromStorage]);

  useEffect(() => {
    const onHydrate = () => hydrateSipStateFromStorage();
    window.addEventListener("profile-changed", onHydrate);
    window.addEventListener("premarket-sip-cloud-hydrated", onHydrate);
    return () => {
      window.removeEventListener("profile-changed", onHydrate);
      window.removeEventListener("premarket-sip-cloud-hydrated", onHydrate);
    };
  }, [hydrateSipStateFromStorage]);

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

  const toggleGapperSip = useCallback(
    (target: SipPersistVariant, payload: { row: GapperRow; headlines: PythonNewsItem[]; catalyst: SipCatalyst | null }) => {
      const { row, headlines, catalyst } = payload;
      const ticker = row.ticker.toUpperCase();
      const inLarge = sipLargeRows.some((r) => r.ticker.toUpperCase() === ticker);
      const inSmall = sipSmallRows.some((r) => r.ticker.toUpperCase() === ticker);
      const inThisList = target === "mid-large" ? inLarge : inSmall;

      if (inThisList) {
        removeFromSip(target, ticker);
        const stillInOtherList = target === "mid-large" ? inSmall : inLarge;
        if (!stillInOtherList) {
          setSipNewsByTicker((prev) => {
            const next = { ...prev };
            delete next[ticker];
            return next;
          });
          setSipCatalystByTicker((prev) => {
            const next = { ...prev };
            delete next[ticker];
            return next;
          });
        }
        return;
      }

      addToSip({ row, headlines, catalyst, target });
    },
    [addToSip, removeFromSip, sipLargeRows, sipSmallRows]
  );

  useEffect(() => {
    const etYmd = ymdInEt();
    const snapLarge = buildLiveSipSnapshot(etYmd, sipLargeRows, sipNewsByTicker, sipCatalystByTicker);
    const snapSmall = buildLiveSipSnapshot(etYmd, sipSmallRows, sipNewsByTicker, sipCatalystByTicker);
    saveSipDaySnapshot(snapLarge, "mid-large");
    saveSipDaySnapshot(snapSmall, "small-cap");
    if (getActiveProfile()) {
      syncPremarketSipBundle({ v: 1, etYmd, midLarge: snapLarge, smallCap: snapSmall });
    }
  }, [sipCatalystByTicker, sipLargeRows, sipNewsByTicker, sipSmallRows]);

  const anySectionExpanded = useMemo(() => SECTION_ORDER.some((id) => !collapsed[id]), [collapsed]);

  useEffect(() => {
    if (!themesRefreshBusy || themesRefreshStartedAtMs == null) return;
    const id = window.setInterval(() => {
      setThemesRefreshElapsedMs(Date.now() - themesRefreshStartedAtMs);
    }, 250);
    return () => window.clearInterval(id);
  }, [themesRefreshBusy, themesRefreshStartedAtMs]);

  const runManualPremarketRefresh = useCallback(async (): Promise<ManualPremarketRefreshResponse> => {
    const res = await fetch("/api/admin/premarket-refresh", {
      method: "POST",
      cache: "no-store",
    });
    // Use res.text() + JSON.parse so a non-JSON body (HTML timeout/error page, gateway
    // error) always yields a clean error string instead of leaking a raw SyntaxError.
    // Also avoids the HTTP/2 empty-statusText trap where res.statusText is "".
    let json: ManualPremarketRefreshResponse;
    try {
      json = JSON.parse(await res.text()) as ManualPremarketRefreshResponse;
    } catch {
      return { ok: false, error: `Server error (HTTP ${res.status})` };
    }
    if (!res.ok) return { ok: false, error: json.error || `Server error (HTTP ${res.status})` };
    return json;
  }, []);

  const triggerThemesRefresh = useCallback(async () => {
    if (themesRefreshBusy) return;
    const startedAtMs = Date.now();
    setThemesRefreshStartedAtMs(startedAtMs);
    setThemesRefreshElapsedMs(0);
    setThemesRefreshError(null);
    setThemesRefreshBusy(true);
    try {
      const result = await runManualPremarketRefresh();

      if (!result.ok) {
        setThemesRefreshError(result.error || "Refresh failed");
        // Still bump the token so the panel refetches whatever is currently in the DB.
        setThemesRefreshToken((v) => v + 1);
        return;
      }

      const elapsedMs = result.elapsedMs ?? Date.now() - startedAtMs;
      setThemesRefreshElapsedMs(elapsedMs);
      setThemesRefreshToken((v) => v + 1);
    } catch (e) {
      setThemesRefreshError(e instanceof Error ? e.message : "Refresh failed");
      setThemesRefreshToken((v) => v + 1);
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
                  {themesRefreshError ? (
                    <span
                      className="pm-site-caption max-w-[18rem] truncate"
                      style={{ color: "var(--warning)" }}
                      title={themesRefreshError}
                    >
                      {themesRefreshError}
                    </span>
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
              ) : undefined
            }
          >
            {s.id === "earnings" ? (
              <EarningsCalendar onOpenTickerInLists={onOpenTickerInLists} />
            ) : s.id === "movers" ? (
              <div className="space-y-3">
                <PremarketGappers
                  filters={gapperFilters}
                  setFilters={setGapperFilters}
                  filtersHydrated={gapperFiltersHydrated}
                  onOpenTickerInLists={onOpenTickerInLists}
                  sipMembershipByTicker={sipMembershipByTicker}
                  onToggleSip={toggleGapperSip}
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
            ) : s.id === "largeCap" ? (
              <LargeCapAnalysisPanel />
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
