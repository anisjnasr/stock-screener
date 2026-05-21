/** Within-day Comp Lab session (ticker + reference state) in localStorage. */

export const COMP_LAB_SESSION_LS_KEY = "stockstalker-comp-lab-session-v1";

export type CompLabSession = {
  version: 1;
  /** US/Eastern calendar day this session belongs to. */
  sessionDateEt: string;
  ticker: string;
  companyName: string;
  referenceDate?: string | null;
};

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

export function loadCompLabSession(sessionDateEt: string): CompLabSession | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(COMP_LAB_SESSION_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CompLabSession>;
    if (
      parsed.version !== 1 ||
      parsed.sessionDateEt !== sessionDateEt ||
      typeof parsed.ticker !== "string" ||
      !parsed.ticker.trim() ||
      typeof parsed.companyName !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      sessionDateEt: parsed.sessionDateEt,
      ticker: parsed.ticker.trim().toUpperCase(),
      companyName: parsed.companyName,
      referenceDate:
        typeof parsed.referenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.referenceDate)
          ? parsed.referenceDate
          : parsed.referenceDate === null
            ? null
            : undefined,
    };
  } catch {
    return null;
  }
}

export function saveCompLabSession(session: CompLabSession): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(COMP_LAB_SESSION_LS_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}

export function clearCompLabSession(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(COMP_LAB_SESSION_LS_KEY);
  } catch {
    /* ignore */
  }
}
