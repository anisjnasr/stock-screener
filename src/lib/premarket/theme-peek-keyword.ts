/** One short keyword for collapsed Context peek (from daily theme title). */
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "after",
  "before",
  "into",
  "over",
  "under",
  "its",
  "are",
  "was",
  "has",
  "have",
  "this",
  "that",
  "than",
  "amid",
  "amidst",
  "us",
  "fed",
  "ceo",
  "cfo",
  "q1",
  "q2",
  "q3",
  "q4",
  "yoy",
  "ytd",
]);

export function keywordFromThemeTitle(raw: string): string {
  const t = raw.replace(/^\s*#\d+\s+/i, "").trim();
  const tokens = t
    .split(/[\s–—:]+/)
    .map((x) => x.replace(/[^\w.-]/g, ""))
    .filter(Boolean);
  for (const tok of tokens) {
    const w = (tok.length > 24 ? tok.slice(0, 24) : tok).trim();
    if (w.length >= 3 && !STOP.has(w.toLowerCase())) return w;
  }
  const fallback = tokens[0]?.slice(0, 14) ?? "—";
  return fallback || "—";
}
