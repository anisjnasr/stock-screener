/** Client-side session cache for Large Cap row results (survives pre-market tab unmount). */

export const LARGE_CAP_SESSION_LS_KEY = "stockstalker-large-cap-session-v1";

export type LargeCapSessionRow = {
  status: "done" | "error";
  stale?: boolean;
  error?: string;
  cache_hit?: boolean;
  analyzed_at?: string;
  digest?: Record<string, unknown>;
  verdict?: Record<string, unknown>;
};

export type LargeCapSession = {
  version: 1;
  profileId: string;
  settingsKey: string;
  tradingDateEt: string;
  lastRunAt: string | null;
  rows: Record<string, LargeCapSessionRow>;
};

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

export function loadLargeCapSession(
  profileId: string,
  settingsKey: string,
  tradingDateEt: string
): LargeCapSession | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(LARGE_CAP_SESSION_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LargeCapSession>;
    if (
      parsed.version !== 1 ||
      parsed.profileId !== profileId ||
      parsed.settingsKey !== settingsKey ||
      parsed.tradingDateEt !== tradingDateEt ||
      !parsed.rows ||
      typeof parsed.rows !== "object"
    ) {
      return null;
    }
    return parsed as LargeCapSession;
  } catch {
    return null;
  }
}

export function saveLargeCapSession(session: LargeCapSession): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(LARGE_CAP_SESSION_LS_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}

export function clearLargeCapSession(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(LARGE_CAP_SESSION_LS_KEY);
  } catch {
    /* ignore */
  }
}
