"use client";

import PreMarketPage from "@/components/premarket/PreMarketPage";
import "@/components/premarket/premarket-terminal.css";

type PreMarketShellProps = {
  /** Navigate to Lists with symbol selected (same as Market Monitor drill-down). */
  onOpenTickerInLists?: (sym: string) => void;
};

/** Full-width pre-market workspace; delegates to `PreMarketPage`. */
export default function PreMarketShell({ onOpenTickerInLists }: PreMarketShellProps) {
  return (
    <div className="premarket-terminal flex min-h-0 min-w-0 flex-1 flex-col">
      <PreMarketPage onOpenTickerInLists={onOpenTickerInLists} />
    </div>
  );
}
