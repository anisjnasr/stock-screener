import "server-only";

import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import { getLatestLargeCapDbSessionDate } from "@/lib/screener-db-native";

/**
 * Session date for Large Cap analysis (premarket day / cache key).
 *
 * Must be strictly after the latest completed EOD session in screener.db so the
 * digest's "prior day" is the freshest bar set, including after same-day refresh.
 */
export function resolveLargeCapAnalysisDate(explicit?: string | null): string {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit.trim())) {
    return explicit.trim();
  }

  const todayEt = ymdInEt();
  const latestDb = getLatestLargeCapDbSessionDate();
  if (!latestDb) return todayEt;

  const minAnalysisDate = addCalendarDaysYmd(latestDb, 1);
  return todayEt >= minAnalysisDate ? todayEt : minAnalysisDate;
}

/** Latest EOD session in the local screener.db (for Python freshness checks). */
export function largeCapDbLatestCompletedDate(): string | null {
  return getLatestLargeCapDbSessionDate();
}

export function largeCapPythonRequestDates(explicitAnalysisDate?: string | null): {
  analysisDate: string;
  dbLatestCompletedDate: string | null;
} {
  return {
    analysisDate: resolveLargeCapAnalysisDate(explicitAnalysisDate),
    dbLatestCompletedDate: largeCapDbLatestCompletedDate(),
  };
}
