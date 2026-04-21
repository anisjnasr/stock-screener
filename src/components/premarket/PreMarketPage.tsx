"use client";

import { useLayoutEffect, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import EarningsCalendar from "./EarningsCalendar";
import EconomicCalendar from "./EconomicCalendar";
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

const SECTIONS: {
  id: PremarketSectionId;
  title: string;
  peekText: string;
  stub: string;
}[] = [
  {
    id: "context",
    title: "Macro & US equities brief",
    peekText: "3 macro · 4 industry themes · Fed, tariffs, AI capex…",
    stub: "",
  },
  {
    id: "sip",
    title: "Stocks in Play",
    peekText: "Gappers + yfinance headlines (Python service)",
    stub: "",
  },
  {
    id: "calendars",
    title: "Economic calendar",
    peekText: "Today's high-impact releases · Fed / Treasury / WH / USTR",
    stub: "",
  },
  {
    id: "earnings",
    title: "Earnings",
    peekText: "YEST: NFLX +9.6 · IBM +8.1 · TODAY BMO: MS, GS, BAC, SCHW",
    stub: "",
  },
  {
    id: "movers",
    title: "Top movers",
    peekText: "15 gappers · $2B+ · 3 policy posts market-relevant",
    stub: "",
  },
];

export default function PreMarketPage() {
  const { collapsed, toggle, setCollapsed, collapseAll, expandAll } = usePremarketLayout();

  const [gapperFilters, setGapperFilters] = useState<GapperFilterState>(DEFAULT_GAPPER_FILTER_STATE);
  const [gapperFiltersHydrated, setGapperFiltersHydrated] = useState(false);

  useLayoutEffect(() => {
    setGapperFilters(loadGapperFiltersFromStorage());
    setGapperFiltersHydrated(true);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: "var(--ws-bg)" }}>
      <TopBar onCollapseAll={collapseAll} onExpandAll={expandAll} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {SECTIONS.map((s) => (
          <CollapsibleSection
            key={s.id}
            id={s.id}
            title={s.title}
            peekText={s.peekText}
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
                <EarningsCalendar />
              </div>
            ) : s.id === "sip" ? (
              <StocksInPlay
                collapsed={collapsed.sip}
                gapperFilters={gapperFilters}
                filtersHydrated={gapperFiltersHydrated}
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
                  <MacroWriteup />
                </div>
                <p className="max-w-prose text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
                  Daily US equities bullets and active themes will load here after Phases 4.5–5.
                </p>
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
