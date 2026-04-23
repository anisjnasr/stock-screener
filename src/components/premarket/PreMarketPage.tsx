"use client";

import { useLayoutEffect, useMemo, useState } from "react";
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
import { formatLatestGeneratedAtEtDisplay } from "@/lib/et-ymd";

const SECTION_ORDER: PremarketSectionId[] = ["context", "sip", "calendars", "earnings", "movers"];

type SectionConfig = {
  id: PremarketSectionId;
  label: string;
  labelAccent?: "cyan" | "amber" | "default";
  stub: string;
};

const SECTIONS: SectionConfig[] = [
  { id: "context", label: "Context", labelAccent: "cyan", stub: "" },
  { id: "sip", label: "Stocks in Play", labelAccent: "amber", stub: "" },
  { id: "calendars", label: "Economic & key events", labelAccent: "cyan", stub: "" },
  { id: "earnings", label: "Earnings", labelAccent: "cyan", stub: "" },
  { id: "movers", label: "Top movers", labelAccent: "default", stub: "" },
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

  const anySectionExpanded = useMemo(() => SECTION_ORDER.some((id) => !collapsed[id]), [collapsed]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <TopBar
        anySectionExpanded={anySectionExpanded}
        onToggleAllSections={() => (anySectionExpanded ? collapseAll() : expandAll())}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {SECTIONS.map((s) => (
          <CollapsibleSection
            key={s.id}
            id={s.id}
            label={s.label}
            labelAccent={s.labelAccent}
            metadata={
              s.id === "context" && !macroLoading && !equitiesLoading
                ? formatLatestGeneratedAtEtDisplay(macroRow?.generated_at, equitiesRow?.generated_at)
                : s.id === "sip"
                  ? "Up to 75 · volume + headline gates"
                  : s.id === "calendars"
                    ? "Today · ET"
                    : s.id === "earnings"
                      ? "Big-cap buckets · ET"
                      : undefined
            }
            peekText={peeks[s.id]}
            collapsed={collapsed[s.id]}
            onToggle={() => toggle(s.id)}
            headerLegend={
              s.id === "calendars" ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span className="impact-high" aria-hidden>
                      ●
                    </span>
                    High
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="impact-med" aria-hidden>
                      ●
                    </span>
                    Med
                  </span>
                </>
              ) : undefined
            }
          >
            {s.id === "calendars" ? (
              <EconomicCalendar />
            ) : s.id === "earnings" ? (
              <EarningsCalendar onOpenTickerInLists={onOpenTickerInLists} />
            ) : s.id === "sip" ? (
              <StocksInPlay
                collapsed={collapsed.sip}
                gapperFilters={gapperFilters}
                filtersHydrated={gapperFiltersHydrated}
                onOpenTickerInLists={onOpenTickerInLists}
              />
            ) : s.id === "movers" ? (
              <div className="space-y-3">
                <PremarketGappers
                  filters={gapperFilters}
                  setFilters={setGapperFilters}
                  filtersHydrated={gapperFiltersHydrated}
                  onOpenTickerInLists={onOpenTickerInLists}
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
                <p className="border-t pt-2" style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)", fontSize: "var(--fs-9)" }}>
                  Policy tape (Truth Social) — Phase 7.
                </p>
              </div>
            ) : s.id === "context" ? (
              <div className="s1-context">
                <div className="min-w-0 space-y-3">
                  <MacroWriteup loading={macroLoading} error={macroError} row={macroRow} ymd={macroYmd} />
                  <EquitiesWriteup
                    loading={equitiesLoading}
                    error={equitiesError}
                    row={equitiesRow}
                    ymd={equitiesYmd}
                    setupHint={equitiesSetupHint}
                  />
                </div>
                <aside className="min-w-0">
                  <DailyThemesPanel />
                </aside>
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
