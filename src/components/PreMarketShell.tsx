"use client";

import PreMarketPage from "@/components/premarket/PreMarketPage";

type PreMarketShellProps = {
  /** Navigate to Lists with symbol selected (same as Market Monitor drill-down). */
  onOpenTickerInLists?: (sym: string) => void;
};

/** Full-width pre-market workspace; delegates to `PreMarketPage`. */
export default function PreMarketShell({ onOpenTickerInLists }: PreMarketShellProps) {
  return <PreMarketPage onOpenTickerInLists={onOpenTickerInLists} />;
}
