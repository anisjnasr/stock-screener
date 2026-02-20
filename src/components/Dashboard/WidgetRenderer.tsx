"use client";

import type { DashboardWidget } from "@/lib/types";
import { IndicesWidget } from "./IndicesWidget";
import { NewsWidget } from "./NewsWidget";
import { WatchlistWidget } from "./WatchlistWidget";
import { PositionsWidget } from "./PositionsWidget";
import { ChartWidget } from "./ChartWidget";

export function WidgetRenderer({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case "indices":
      return <IndicesWidget />;
    case "news":
      return <NewsWidget />;
    case "watchlist":
      return <WatchlistWidget />;
    case "positions":
      return <PositionsWidget />;
    case "chart":
      return <ChartWidget />;
    default:
      return (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
          <p className="text-zinc-500">Unknown widget</p>
        </div>
      );
  }
}
