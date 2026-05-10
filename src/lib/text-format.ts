/**
 * Text formatting for display (e.g. industry names).
 */

const INDUSTRY_ACRONYM_CANON: Readonly<Record<string, string>> = {
  ai: "AI",
  adr: "ADR",
  adrs: "ADRs",
  ar: "AR",
  ev: "EV",
  etf: "ETF",
  etfs: "ETFs",
  ml: "ML",
  reit: "REIT",
  reits: "REITs",
  vr: "VR",
  lng: "LNG",
  oem: "OEM",
  saas: "SaaS",
  iot: "IoT",
};

function normalizeIndustryToken(token: string): string {
  const lower = token.toLowerCase();
  const canon = INDUSTRY_ACRONYM_CANON[lower];
  if (canon) return canon;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Display casing for FMP/GICS-style industry strings (token-aware; handles ALL CAPS).
 * Keep logic aligned with `scripts/normalize-industry-casing.mjs` (DB batch job).
 */
export function normalizeIndustryDisplayName(raw: string | null | undefined): string {
  if (raw == null) return "";
  const t = String(raw).trim();
  if (!t || t.toUpperCase() === "NA") return t;
  return t.replace(/[A-Za-z][A-Za-z0-9']*/g, (token) => normalizeIndustryToken(token));
}

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
