import type { DashboardWidget, WidgetType } from "./types";

const STORAGE_KEY = "stock_tool_dashboard";

export function getDashboardWidgets(): DashboardWidget[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultWidgets();
    const parsed = JSON.parse(raw) as unknown[];
    return Array.isArray(parsed) ? (parsed as DashboardWidget[]) : getDefaultWidgets();
  } catch {
    return getDefaultWidgets();
  }
}

function getDefaultWidgets(): DashboardWidget[] {
  return [
    { id: "w1", type: "indices", config: {} },
    { id: "w2", type: "news", config: {} },
    { id: "w3", type: "watchlist", config: {} },
  ];
}

export function saveDashboardWidgets(widgets: DashboardWidget[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
}

export function addWidget(type: WidgetType, config: Record<string, unknown> = {}): DashboardWidget {
  const widgets = getDashboardWidgets();
  const id = "w" + Date.now();
  const newW: DashboardWidget = { id, type, config };
  widgets.push(newW);
  saveDashboardWidgets(widgets);
  return newW;
}

export function removeWidget(id: string): void {
  const widgets = getDashboardWidgets().filter((w) => w.id !== id);
  saveDashboardWidgets(widgets);
}

export function reorderWidgets(fromIndex: number, toIndex: number): void {
  const widgets = [...getDashboardWidgets()];
  const [removed] = widgets.splice(fromIndex, 1);
  if (removed) widgets.splice(toIndex, 0, removed);
  saveDashboardWidgets(widgets);
}
