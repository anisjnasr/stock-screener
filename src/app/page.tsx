"use client";

import { useState, useEffect } from "react";
import {
  getDashboardWidgets,
  saveDashboardWidgets,
  addWidget,
  removeWidget,
  reorderWidgets,
} from "@/lib/dashboard-storage";
import type { DashboardWidget, WidgetType } from "@/lib/types";
import { WidgetRenderer } from "@/components/Dashboard/WidgetRenderer";

const WIDGET_TYPES: { type: WidgetType; label: string }[] = [
  { type: "indices", label: "Indices" },
  { type: "chart", label: "Chart" },
  { type: "watchlist", label: "Watchlist" },
  { type: "positions", label: "Positions" },
  { type: "news", label: "News" },
];

export default function HomePage() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setWidgets(getDashboardWidgets());
  }, []);

  const handleAdd = (type: WidgetType) => {
    addWidget(type);
    setWidgets(getDashboardWidgets());
    setShowAdd(false);
  };

  const handleRemove = (id: string) => {
    removeWidget(id);
    setWidgets(getDashboardWidgets());
  };

  const handleMove = (index: number, direction: 1 | -1) => {
    const next = index + direction;
    if (next < 0 || next >= widgets.length) return;
    reorderWidgets(index, next);
    setWidgets(getDashboardWidgets());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Add widget
          </button>
          {showAdd && (
            <div className="absolute top-24 right-4 z-10 rounded-lg border border-zinc-600 bg-zinc-800 p-2 shadow-xl">
              {WIDGET_TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleAdd(type)}
                  className="block w-full rounded px-3 py-1.5 text-left text-sm text-white hover:bg-zinc-700"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-sm text-zinc-400">
        Data may be delayed. Limited by free tier.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((widget, index) => (
          <div key={widget.id} className="relative group">
            <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                onClick={() => handleMove(index, -1)}
                disabled={index === 0}
                className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-white hover:bg-zinc-600 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => handleMove(index, 1)}
                disabled={index === widgets.length - 1}
                className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-white hover:bg-zinc-600 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => handleRemove(widget.id)}
                className="rounded bg-red-900/50 px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-800/50"
              >
                Remove
              </button>
            </div>
            <WidgetRenderer widget={widget} />
          </div>
        ))}
      </div>

      {widgets.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-600 bg-zinc-800/50 p-8 text-center">
          <p className="mb-4 text-zinc-400">No widgets yet.</p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
          >
            Add widget
          </button>
        </div>
      )}
    </div>
  );
}
