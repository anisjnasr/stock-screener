import { cloudSyncSetting } from "@/lib/cloud-sync";

export const LARGE_CAP_SETTINGS_LS_KEY = "stockstalker-large-cap-settings-v1";
export const LARGE_CAP_SETTINGS_CLOUD_KEY = "large_cap_settings_v1";

export type LargeCapDataMode = "historical" | "historical_premarket";

export type LargeCapSettings = {
  selectedListId: string | null;
  dataMode: LargeCapDataMode;
};

const DEFAULTS: LargeCapSettings = {
  selectedListId: null,
  dataMode: "historical_premarket",
};

export function loadLargeCapSettings(): LargeCapSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(LARGE_CAP_SETTINGS_LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LargeCapSettings>;
    const dataMode =
      parsed.dataMode === "historical" || parsed.dataMode === "historical_premarket"
        ? parsed.dataMode
        : DEFAULTS.dataMode;
    return {
      selectedListId: typeof parsed.selectedListId === "string" ? parsed.selectedListId : null,
      dataMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLargeCapSettings(next: LargeCapSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LARGE_CAP_SETTINGS_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  cloudSyncSetting(LARGE_CAP_SETTINGS_CLOUD_KEY, next);
  window.dispatchEvent(new CustomEvent("stockstalker-large-cap-settings-changed", { detail: next }));
}

export function applyCloudLargeCapSettings(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const v = value as Partial<LargeCapSettings>;
  const current = loadLargeCapSettings();
  const merged: LargeCapSettings = {
    selectedListId:
      typeof v.selectedListId === "string" ? v.selectedListId : current.selectedListId,
    dataMode:
      v.dataMode === "historical" || v.dataMode === "historical_premarket"
        ? v.dataMode
        : current.dataMode,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LARGE_CAP_SETTINGS_LS_KEY, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
  }
}
