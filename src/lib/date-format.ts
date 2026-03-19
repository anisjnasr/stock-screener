/**
 * Platform-wide date display format: d-mmm-yyyy (e.g. 27-Feb-2025).
 * Times use AM/PM.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a date for display as "d-mmm-yyyy".
 * Accepts Date, ISO string (YYYY-MM-DD or full ISO), or timestamp (ms).
 */
export function formatDisplayDate(input: Date | string | number): string {
  const d = typeof input === "number" ? new Date(input) : typeof input === "string" ? new Date(input.trim()) : input;
  if (Number.isNaN(d.getTime())) return String(input);
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Format a date with time for display: "d-mmm-yyyy, h:mm am/pm".
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
