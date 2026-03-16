/**
 * Platform-wide date display format: "2nd March 2026".
 * Times use AM/PM.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinal(day: number): string {
  const rem10 = day % 10;
  const rem100 = day % 100;
  if (rem10 === 1 && rem100 !== 11) return `${day}st`;
  if (rem10 === 2 && rem100 !== 12) return `${day}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${day}rd`;
  return `${day}th`;
}

/**
 * Format a date for display as "2nd March 2026".
 * Accepts Date, ISO string (YYYY-MM-DD or full ISO), or timestamp (ms).
 */
export function formatDisplayDate(input: Date | string | number): string {
  const d = typeof input === "number" ? new Date(input) : typeof input === "string" ? new Date(input.trim()) : input;
  if (Number.isNaN(d.getTime())) return String(input);
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${ordinal(day)} ${month} ${year}`;
}

/**
 * Format a date with time for display: "2nd March 2026, h:mm AM/PM".
 */
export function formatDisplayDateTime(input: Date | string | number): string {
  const d = typeof input === "number" ? new Date(input) : typeof input === "string" ? new Date(input.trim()) : input;
  if (Number.isNaN(d.getTime())) return String(input);
  const datePart = formatDisplayDate(d);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const time = `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
  return `${datePart}, ${time}`;
}
