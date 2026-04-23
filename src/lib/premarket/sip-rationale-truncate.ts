/** Truncate catalyst copy for dense SIP grid (render-only; no API change). */
export function truncateSipRationale(text: string, maxWords = 14): string {
  const t = text.trim();
  if (!t) return "—";
  const firstSentence = t.split(/(?<=[.!?])\s+/)[0]?.trim() ?? t;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return firstSentence;
  return `${words.slice(0, maxWords).join(" ")}…`;
}
