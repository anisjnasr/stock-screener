"use client";

import MarketIndexCards, { type MarketIndexSymbol } from "@/components/MarketIndexCards";

/** SPY / QQQ / IWM row + credit line — shared by MarketLeftPanel (embedded) and page (full-width strip above split). */
export default function MarketIndexHeaderBlock({
  indexCardSelection,
  onIndexCardClick,
}: {
  indexCardSelection: MarketIndexSymbol | null;
  onIndexCardClick: (sym: MarketIndexSymbol) => void;
}) {
  return (
    <div className="shrink-0 flex flex-col min-w-max">
      <MarketIndexCards indexCardSelection={indexCardSelection} onCardClick={onIndexCardClick} />
      <p
        className="shrink-0 text-center text-xs uppercase tracking-wide py-2 px-4 border-b"
        style={{ color: "var(--ws-text-vdim)", borderColor: "var(--ws-border)" }}
      >
        Credit: Stockbee
      </p>
    </div>
  );
}
