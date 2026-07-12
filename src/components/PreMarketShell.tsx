"use client";

import PreMarketPage from "@/components/premarket/PreMarketPage";
import "@/components/premarket/premarket-terminal.css";

/** Full-width pre-market workspace; delegates to `PreMarketPage`. */
export default function PreMarketShell() {
  return (
    <div className="premarket-terminal flex min-h-0 min-w-0 flex-1 flex-col">
      <PreMarketPage />
    </div>
  );
}
