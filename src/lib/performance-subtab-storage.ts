import { cloudSyncSetting } from "@/lib/cloud-sync";
import type { SectorSubTab } from "@/components/WorkspaceHeader";

export const PERFORMANCE_SUBTAB_LS_KEY = "stockstalker-performance-subtab-v1";
export const PERFORMANCE_SUBTAB_CLOUD_KEY = "performance_subtab_v1";

const VALID: SectorSubTab[] = ["indices", "sectors", "industries"];
export const DEFAULT_PERFORMANCE_SUBTAB: SectorSubTab = "indices";

function parseSubTab(raw: unknown): SectorSubTab | null {
  return typeof raw === "string" && (VALID as string[]).includes(raw) ? (raw as SectorSubTab) : null;
}

export function loadPerformanceSubTab(): SectorSubTab {
  if (typeof window === "undefined") return DEFAULT_PERFORMANCE_SUBTAB;
  try {
    const raw = localStorage.getItem(PERFORMANCE_SUBTAB_LS_KEY);
    if (!raw) return DEFAULT_PERFORMANCE_SUBTAB;
    return parseSubTab(raw) ?? DEFAULT_PERFORMANCE_SUBTAB;
  } catch {
    return DEFAULT_PERFORMANCE_SUBTAB;
  }
}

export function savePerformanceSubTab(tab: SectorSubTab): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERFORMANCE_SUBTAB_LS_KEY, tab);
  } catch {
    /* ignore */
  }
  cloudSyncSetting(PERFORMANCE_SUBTAB_CLOUD_KEY, tab);
  window.dispatchEvent(new CustomEvent("stockstalker-performance-subtab-changed", { detail: tab }));
}

export function applyCloudPerformanceSubTab(value: unknown): void {
  const tab = parseSubTab(value);
  if (!tab || typeof window === "undefined") return;
  try {
    localStorage.setItem(PERFORMANCE_SUBTAB_LS_KEY, tab);
  } catch {
    /* ignore */
  }
}
