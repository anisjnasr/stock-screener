import type { CompLabCandle } from "@/lib/complab/chart-series";

export type ReferenceDateContext = {
  todayEt: string;
  validDates: Set<string>;
  earliestDate: string | null;
  latestSelectableDate: string | null;
};

export function formatReferenceDateDisplay(isoYmd: string): string {
  const [y, m, d] = isoYmd.split("-");
  if (!y || !m || !d) return isoYmd;
  return `${d}-${m}-${y}`;
}

export function parseReferenceDateInput(raw: string): string | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

export function isWeekendYmd(isoYmd: string): boolean {
  const d = new Date(`${isoYmd}T12:00:00.000Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function buildReferenceDateContext(candles: CompLabCandle[], todayEt: string): ReferenceDateContext {
  const sorted = candles
    .map((c) => c.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => a.localeCompare(b));

  const validDates = new Set(sorted.filter((d) => d < todayEt));
  const validList = [...validDates].sort((a, b) => a.localeCompare(b));

  return {
    todayEt,
    validDates,
    earliestDate: validList[0] ?? null,
    latestSelectableDate: validList[validList.length - 1] ?? null,
  };
}

export function isSelectableReferenceDate(date: string, ctx: ReferenceDateContext): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (date >= ctx.todayEt) return false;
  if (isWeekendYmd(date)) return false;
  return ctx.validDates.has(date);
}

export function referenceDateInvalidReason(date: string, ctx: ReferenceDateContext): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Use dd-mm-yyyy";
  if (date >= ctx.todayEt) return "Today and future dates are not valid";
  if (isWeekendYmd(date)) return "Weekends are not valid";
  if (!ctx.validDates.has(date)) return "No market session on this date";
  if (ctx.earliestDate && date < ctx.earliestDate) return "Before available history";
  return null;
}

export function isoFromCalendarParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function calendarMonthStart(year: number, month: number): { year: number; month: number } {
  if (month < 1) return calendarMonthStart(year - 1, 12);
  if (month > 12) return calendarMonthStart(year + 1, 1);
  return { year, month };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Next trading session after `referenceDate` from a sorted list of session dates. */
export function nextTradingSessionAfter(referenceDate: string, sortedSessionDates: string[]): string | null {
  for (const d of sortedSessionDates) {
    if (d > referenceDate) return d;
  }
  return null;
}

/** Strip to digits and cap at dd-mm-yyyy (8 digits). */
export function referenceDateInputDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 8);
}

/** Build a partial dd-mm-yyyy display from digit input. */
export function formatPartialReferenceDateInput(raw: string): string {
  const digits = referenceDateInputDigits(raw);
  if (digits.length === 0) return "";

  let out = digits.slice(0, 2);
  if (digits.length >= 3) out += `-${digits.slice(2, 4)}`;
  else if (digits.length === 2) out += "-";

  if (digits.length >= 5) out += `-${digits.slice(4, 8)}`;
  else if (digits.length === 4) out += "-";

  return out;
}

/** Caret index after typing the given number of date digits. */
export function referenceDateInputCaret(digitCount: number): number {
  if (digitCount <= 0) return 0;
  if (digitCount < 2) return digitCount;
  if (digitCount === 2) return 3;
  if (digitCount < 4) return digitCount + 1;
  if (digitCount === 4) return 6;
  return Math.min(digitCount + 2, 10);
}
