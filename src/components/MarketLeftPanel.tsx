"use client";

import MarketMonitorTable from "@/components/MarketMonitorTable";
import MarketIndexHeaderBlock from "@/components/MarketIndexHeaderBlock";
import CotPanel from "@/components/cot/CotPanel";
import type { MarketIndexSymbol } from "@/components/MarketIndexCards";
import type { MarketMonitorListCreatedInfo } from "@/components/MarketMonitorConstituentsModal";

export default function MarketLeftPanel({
  onSymbolSelect,
  indexCardSelection,
  onIndexCardClick,
  onWatchlistListCreated,
  /** When true, index cards + credit render in the page chrome above the split; this panel is table only. */
  omitIndexHeader = false,
}: {
  onSymbolSelect?: (sym: string) => void;
  indexCardSelection: MarketIndexSymbol | null;
  onIndexCardClick: (sym: MarketIndexSymbol) => void;
  onWatchlistListCreated?: (info: MarketMonitorListCreatedInfo) => void;
  omitIndexHeader?: boolean;
}) {
  return (
    <div
      className="h-full min-h-0 flex flex-col overflow-x-auto overflow-y-hidden"
      style={{ background: "var(--ws-bg2)" }}
    >
      <div className="flex min-w-max flex-col h-full min-h-0">
        {!omitIndexHeader && (
          <MarketIndexHeaderBlock indexCardSelection={indexCardSelection} onIndexCardClick={onIndexCardClick} />
        )}
        <div className="flex min-h-0 min-w-max flex-1 flex-col overflow-y-auto">
          <CotPanel />
          <MarketMonitorTable onSymbolSelect={onSymbolSelect} onWatchlistListCreated={onWatchlistListCreated} />
        </div>
      </div>
    </div>
  );
}
