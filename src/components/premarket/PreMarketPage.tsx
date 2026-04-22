"use client";

import { useLayoutEffect, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import EarningsCalendar from "./EarningsCalendar";
import EconomicCalendar from "./EconomicCalendar";
import DailyThemesPanel from "./DailyThemesPanel";
import EquitiesWriteup from "./EquitiesWriteup";
import MacroWriteup from "./MacroWriteup";
import PremarketGappers from "./PremarketGappers";
import StocksInPlay from "./StocksInPlay";
import TopBar from "./TopBar";
import { usePremarketLayout } from "./usePremarketLayout";
import type { PremarketSectionId } from "./premarket-layout-storage";
import {
  DEFAULT_GAPPER_FILTER_STATE,
  loadGapperFiltersFromStorage,
  type GapperFilterState,
} from "@/components/premarket/gapper-filters-storage";
import { usePremarketPeeks } from "@/hooks/usePremarketPeeks";

const SECTIONS: {
  id: PremarketSectionId;
  title: string;
  stub: string;
}[] = [
  {
    id: "context",
    title: "Macro & US equities brief",
    stub: "",
  },
  {
    id: "sip",
    title: "Stocks in Play",
    stub: "",
  },
  {
    id: "calendars",
    title: "Economic calendar",
    stub: "",
  },
  {
    id: "earnings",
    title: "Earnings",
    stub: "",
  },
  {
    id: "movers",
    title: "Top movers",
    stub: "",
  },
];

type PreMarketPageProps = {
  onOpenTickerInLists?: (sym: string) => void;
};

export default function PreMarketPage({ onOpenTickerInLists }: PreMarketPageProps) {
  const { collapsed, toggle, setCollapsed, collapseAll, expandAll } = usePremarketLayout();

  const [gapperFilters, setGapperFilters] = useState<GapperFilterState>(DEFAULT_GAPPER_FILTER_STATE);
  const [gapperFiltersHydrated, setGapperFiltersHydrated] = useState(false);

  useLayoutEffect(() => {
    setGapperFilters(loadGapperFiltersFromStorage());
    setGapperFiltersHydrated(true);
  }, []);

  const {
    peeks,
    macroRow,
    macroYmd,
    macroLoading,
    macroError,
    equitiesRow,
    equitiesYmd,
    equitiesLoading,
    equitiesError,
    equitiesSetupHint,
  } = usePremarketPeeks(gapperFilters, gapperFiltersHydrated);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: "var(--ws-bg)" }}>
      <TopBar onCollapseAll={collapseAll} onExpandAll={expandAll} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {SECTIONS.map((s) => (
          <CollapsibleSection
            key={s.id}
            id={s.id}
            title={s.title}
            peekText={peeks[s.id]}
            collapsed={collapsed[s.id]}
            onToggle={() => toggle(s.id)}
          >
            {s.id === "calendars" ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                  Today
                </h3>
                <EconomicCalendar />
              </div>
            ) : s.id === "earnings" ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                  Earnings calendar
                </h3>
                <EarningsCalendar onOpenTickerInLists={onOpenTickerInLists} />
              </div>
            ) : s.id === "sip" ? (
              <StocksInPlay
                collapsed={collapsed.sip}
                gapperFilters={gapperFilters}
                filtersHydrated={gapperFiltersHydrated}
                onOpenTickerInLists={onOpenTickerInLists}
              />
            ) : s.id === "movers" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Pre-market gappers
                  </h3>
                  <PremarketGappers
                    filters={gapperFilters}
                    setFilters={setGapperFilters}
                    filtersHydrated={gapperFiltersHydrated}
                    onOpenTickerInLists={onOpenTickerInLists}
                    onJumpToEarnings={() => {
                      setCollapsed("earnings", false);
                      queueMicrotask(() => {
                        document
                          .querySelector("[data-premarket-section=\"earnings\"]")
                          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      });
                    }}
                  />
                </div>
                <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
                  Policy tape (Truth Social) — Phase 7.
                </p>
              </div>
            ) : s.id === "context" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Today&apos;s macro writeup
                  </h3>
                  <MacroWriteup loading={macroLoading} error={macroError} row={macroRow} ymd={macroYmd} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    US equities writeup
                  </h3>
                  <EquitiesWriteup
                    loading={equitiesLoading}
                    error={equitiesError}
                    row={equitiesRow}
                    ymd={equitiesYmd}
                    setupHint={equitiesSetupHint}
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Daily themes
                  </h3>
                  <DailyThemesPanel />
                </div>
              </div>
            ) : (
              <p className="max-w-prose leading-relaxed">{s.stub}</p>
            )}
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
