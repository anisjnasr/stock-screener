/** Phase 12B–C: per-ticker SIP catalyst classification (LLM from headlines + scan context). */

export type SipCatalystCategory =
  | "earnings"
  | "guidance"
  | "m_and_a"
  | "partnership"
  | "product"
  | "regulatory"
  | "analyst"
  | "macro_sector"
  | "other"
  | "unclear";

export type SipGuidanceTone = "positive" | "negative" | "neutral" | "mixed";

export type SipConfidence = "high" | "medium" | "low";

/** LLM gates after hard volume filters (both must be true to qualify). */
export type SipQualifyingChecks = {
  /** Headline(s) are primarily about this company, not a ticker mentioned in a multi-stock roundup / newsletter scan. */
  company_specific_news: boolean;
  /** News is fresh: published within the last 24 hours (use headline timestamps when provided). */
  surprises_market: boolean;
};

export type SipCatalyst = {
  category: SipCatalystCategory;
  /** Primary narrative (from model `catalyst_rationale`). */
  summary: string;
  guidance_tone: SipGuidanceTone | null;
  confidence: SipConfidence;
  qualifies_as_sip: boolean;
  checks: SipQualifyingChecks;
  /** Sort key among qualifiers only (1–10 after theme bonus). */
  ranking_score: number;
  catalyst_source_urls: string[];
  macro_aligned: boolean;
  macro_theme_tag: string | null;
  industry_aligned: boolean;
  industry_theme_tag: string | null;
};
