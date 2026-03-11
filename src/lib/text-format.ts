/**
 * Text formatting for display (e.g. industry names).
 */

/** Sentence case: only the first letter capitalized, rest lowercase. */
export function toSentenceCase(s: string): string {
  if (!s || typeof s !== "string") return s;
  const t = s.trim();
  if (t === "" || t === "NA") return s;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Title case: capitalize the first letter of each word, rest lowercase. */
export function toTitleCase(s: string): string {
  if (!s || typeof s !== "string") return s;
  const t = s.trim();
  if (t === "" || t === "NA") return s;
  return t
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
