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
  { id: "sip", label: "Stocks in Play", labelAccent: "cyan", stub: "" },
  { id: "calendars", label: "Economic & key events", labelAccent: "cyan", stub: "" },
  { id: "earnings", label: "Earnings", labelAccent: "cyan", stub: "" },
  { id: "movers", label: "Top movers", labelAccent: "cyan", stub: "" },
];

type PreMarketPageProps = {
  onOpenTickerInLists?: (sym: string) => void;
};

export default function PreMarketPage({ onOpenTickerInLists }: PreMarketPageProps) {
  const { collapsed, toggle, setCollapsed, collapseAll, expandAll } = usePremarketLayout();

  const [gapperFilters, setGapperFilters] = useState<GapperFilterState>(DEFAULT_GAPPER_FILTER_STATE);
  const [gapperFiltersHydrated, setGapperFiltersHydrated] = useState(false);

  useLayoutEffect(() => {
    queueMicrotask(() => {
      setGapperFilters(loadGapperFiltersFromStorage());
      setGapperFiltersHydrated(true);
    });
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
            actions={
              s.id === "context" ? (
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
