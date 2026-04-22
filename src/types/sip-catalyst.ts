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

export type SipCatalyst = {
  category: SipCatalystCategory;
  summary: string;
  guidance_tone: SipGuidanceTone | null;
  confidence: SipConfidence;
};
