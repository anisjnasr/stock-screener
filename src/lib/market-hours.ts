/**
 * US stock market hours (NYSE/NASDAQ): 9:30 AM - 4:00 PM Eastern, Mon-Fri.
 * Returns true if currently within regular trading session.
 * Does not account for market holidays or early closes.
 */
export function isUSMarketOpen(): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[wd] ?? 0;

  if (day === 0 || day === 6) return false;
  const timeMinutes = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60 + 0;
  return timeMinutes >= openMinutes && timeMinutes < closeMinutes;
}
