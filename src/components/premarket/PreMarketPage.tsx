"use client";

import CollapsibleSection from "./CollapsibleSection";
import EarningsCalendar from "./EarningsCalendar";
import EconomicCalendar from "./EconomicCalendar";
import KeyEvents from "./KeyEvents";
import PremarketGappers from "./PremarketGappers";
import TopBar from "./TopBar";
import { usePremarketLayout } from "./usePremarketLayout";
import type { PremarketSectionId } from "./premarket-layout-storage";

const SECTIONS: {
  id: PremarketSectionId;
  title: string;
  peekText: string;
  stub: string;
}[] = [
  {
    id: "context",
    title: "Context",
    peekText: "3 macro · 4 industry themes · Fed, tariffs, AI capex…",
    stub: "Daily macro writeup and themes will load here after Phases 4–5.",
  },
  {
    id: "sip",
    title: "Stocks in Play",
    peekText: "NVDA +4.8 · MU +6.2 · CCJ +4.1 · CAVA +5.1 · LULU −8.1",
    stub: "High-significance catalyst names will appear here after Phase 12.",
  },
  {
    id: "calendars",
    title: "Calendars",
    peekText: "4 high-impact econ · Fed / Treasury / WH / USTR",
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
    title: "Top Movers + Policy",
    peekText: "15 gappers · $2B+ · 3 policy posts market-relevant",
    stub: "",
  },
];

export default function PreMarketPage() {
  const { collapsed, toggle, setCollapsed, collapseAll, expandAll } = usePremarketLayout();

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
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Economic calendar
                  </h3>
                  <EconomicCalendar />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Policy & Fed
                  </h3>
                  <KeyEvents />
                </div>
              </div>
            ) : s.id === "earnings" ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                  Earnings calendar
                </h3>
                <EarningsCalendar />
              </div>
            ) : s.id === "movers" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Pre-market gappers
                  </h3>
                  <PremarketGappers
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
            ) : (
              <p className="max-w-prose leading-relaxed">{s.stub}</p>
            )}
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
