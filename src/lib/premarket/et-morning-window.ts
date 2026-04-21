import { DateTime } from "luxon";

const ET = "America/New_York";

/** Inclusive start, exclusive end of the 4:00–7:00 AM ET window on `ymd` (YYYY-MM-DD). */
export function etMorningNewsletterWindow(ymd: string): { startUtcIso: string; endUtcIso: string } {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`Invalid ymd: ${ymd}`);
  }
  const start = DateTime.fromObject({ year: y, month: m, day: d, hour: 4, minute: 0, second: 0, millisecond: 0 }, { zone: ET });
  const end = DateTime.fromObject({ year: y, month: m, day: d, hour: 7, minute: 0, second: 0, millisecond: 0 }, { zone: ET });
  return { startUtcIso: start.toUTC().toISO()!, endUtcIso: end.toUTC().toISO()! };
}
