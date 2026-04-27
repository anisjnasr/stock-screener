/** Keep up to the first 3 sentences for SIP catalyst copy (render-only; no API change). */
export function truncateSipRationale(text: string): string {
  const t = text.trim();
  if (!t) return "—";
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 3) return t;
  return `${sentences.slice(0, 3).join(" ")}…`;
}
