/** America/New_York calendar helpers for pre-market news filtering. */

const ET = "America/New_York";

/** Today's date in ET as YYYY-MM-DD. */
export function todayYmdEt(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: ET });
}

/**
 * Prior NYSE session calendar date in ET (skips Sat/Sun).
 * e.g. Monday → previous Friday.
 */
export function priorTradingSessionYmdEt(now = new Date()): string {
  for (let daysBack = 1; daysBack <= 10; daysBack++) {
    const probe = new Date(now.getTime() - daysBack * 86_400_000);
    const wd = probe.toLocaleDateString("en-US", { timeZone: ET, weekday: "short" });
    if (wd !== "Sat" && wd !== "Sun") {
      return probe.toLocaleDateString("en-CA", { timeZone: ET });
    }
  }
  return todayYmdEt(now);
}

export function publishedUtcToYmdEt(publishedUtc: string): string | null {
  const d = new Date(publishedUtc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: ET });
}

/** Article counts if its ET calendar date is today or the prior trading session. */
export function isNewsInPremarketWindow(
  publishedUtc: string,
  todayYmd: string,
  priorSessionYmd: string
): boolean {
  const ymd = publishedUtcToYmdEt(publishedUtc);
  if (!ymd) return false;
  return ymd === todayYmd || ymd === priorSessionYmd;
}
