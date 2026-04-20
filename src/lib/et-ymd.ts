/** Calendar YYYY-MM-DD in America/New_York for `now`. */
export function ymdInEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Add whole calendar days to a YYYY-MM-DD (UTC date math on date parts). */
export function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [ys, ms, ds] = ymd.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** `{ y, m }` for ET calendar month of `now` (m = 1–12). */
export function yearMonthInEt(now = new Date()): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  return { y, m };
}

/** Fed-style month URL segment `YYYY-MM` (zero-padded month). */
export function fedMonthPathSegment(y: number, m: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

export function addCalendarMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}
