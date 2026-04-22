/**
 * Collapsed-header peek for macro: 3–4 short topic keywords (not sentence fragments), e.g.
 * "Trump - Fed Chair Nominee - Markets Slowed".
 */

const LEADING_STOPS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "as",
  "is",
  "was",
  "are",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "with",
  "by",
  "from",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "into",
  "over",
  "under",
  "not",
  "no",
  "so",
  "than",
  "then",
  "if",
  "while",
  "when",
  "where",
  "after",
  "before",
  "during",
  "through",
  "amid",
  "among",
  "between",
  "against",
  "also",
  "just",
  "only",
  "even",
  "still",
  "very",
  "about",
  "there",
  "here",
  "we",
  "you",
  "he",
  "she",
  "they",
  "i",
  "who",
  "which",
  "what",
  "how",
  "why",
  "because",
  "although",
  "though",
  "yet",
]);

const TRAILING_TRIM = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
]);

function stripLeadingStops(words: string[]): string[] {
  const w = [...words];
  while (w.length && LEADING_STOPS.has(w[0].toLowerCase().replace(/[^a-z]/g, ""))) {
    w.shift();
  }
  return w;
}

function trimTrailingLowValue(words: string[]): string[] {
  const w = [...words];
  while (w.length) {
    const t = w[w.length - 1].toLowerCase().replace(/[^a-z]/g, "");
    if (!TRAILING_TRIM.has(t)) break;
    w.pop();
  }
  return w;
}

function compactWordList(words: string[], maxWords: number, maxChars: number): string {
  const w = words.filter(Boolean);
  if (!w.length) return "";
  let take = w.slice(0, maxWords);
  let s = take.join(" ");
  if (s.length > maxChars && take.length > 1) {
    take = w.slice(0, Math.max(1, maxWords - 1));
    s = take.join(" ");
  }
  if (s.length > maxChars && take.length > 1) {
    s = w[0];
  }
  return s.trim();
}

function titleCaseChunk(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^[A-Z]{2,}$/.test(w)) return w;
      if (w.length === 0) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Multi-word capitalized phrase or single cap token / ticker. */
function extractCapitalPhrases(s: string): string[] {
  const re = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b|\b[A-Z][a-z]+\b|\b[A-Z]{2,}\b/g;
  return [...s.matchAll(re)].map((m) => m[0]).filter((t) => t.length >= 2);
}

function topicFromSentence(sentence: string): string {
  const s = sentence.replace(/\s+/g, " ").trim();
  if (!s) return "";

  const commaIdx = s.indexOf(",");
  if (commaIdx > 0 && commaIdx < 120) {
    const head = s.slice(0, commaIdx).trim();
    const headCaps = extractCapitalPhrases(head);
    if (headCaps.length >= 2) {
      const a = headCaps[0];
      const b = headCaps[1];
      if (a.length + b.length + 1 <= 26) return titleCaseChunk(`${a} ${b}`);
      return titleCaseChunk(a);
    }
    if (headCaps.length === 1) {
      const t = titleCaseChunk(headCaps[0]);
      if (t.length >= 2) return t;
    }
    let w = stripLeadingStops(head.split(/\s+/).filter(Boolean));
    w = trimTrailingLowValue(w);
    while (w.length > 1 && w[0].length > 3 && w[0].toLowerCase().endsWith("ly")) w.shift();
    const t = compactWordList(w, 3, 30);
    if (t.length >= 2) return titleCaseChunk(t);
  }

  const caps = extractCapitalPhrases(s);
  if (caps.length) {
    const multi = caps.find((p) => p.includes(" "));
    if (multi) {
      const parts = multi.split(/\s+/);
      return titleCaseChunk(compactWordList(parts, 4, 32));
    }
    if (caps.length >= 2) {
      const a = caps[0];
      const b = caps[1];
      if (a.length + b.length + 1 <= 22) return titleCaseChunk(`${a} ${b}`);
      return titleCaseChunk(a);
    }
    return titleCaseChunk(caps[0]);
  }

  let w = stripLeadingStops(s.split(/\s+/).filter(Boolean));
  while (w.length > 1 && w[0].length > 3 && w[0].toLowerCase().endsWith("ly")) w.shift();
  w = trimTrailingLowValue(w);
  const t = compactWordList(w, 3, 30);
  return titleCaseChunk(t || s.slice(0, 24).trim());
}

export function deriveMacroPeekKeywords(writeup: string): string {
  const text = writeup.replace(/\s+/g, " ").trim();
  if (!text) return "";

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/[.!?]+$/g, "").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sent of sentences) {
    if (chunks.length >= 4) break;
    const topic = topicFromSentence(sent);
    if (!topic) continue;
    if (chunks.length && chunks[chunks.length - 1] === topic) continue;
    chunks.push(topic);
  }

  const out = chunks.join(" - ");
  return out.length > 140 ? `${out.slice(0, 137)}…` : out;
}
