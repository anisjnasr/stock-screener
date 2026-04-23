import type { SipCatalyst, SipCatalystCategory, SipGuidanceTone } from "@/types/sip-catalyst";

export type SipBadgeToken = {
  className: string;
  label: string;
};

function guidanceClass(tone: SipGuidanceTone): string {
  switch (tone) {
    case "positive":
      return "badge-guidance-pos";
    case "negative":
      return "badge-guidance-neg";
    case "mixed":
      return "badge-reg";
    case "neutral":
    default:
      return "badge-guidance-neu";
  }
}

function categoryLabel(cat: SipCatalystCategory): string {
  const map: Record<SipCatalystCategory, string> = {
    earnings: "Earnings",
    guidance: "Guidance",
    m_and_a: "M&A",
    partnership: "Partnership",
    product: "Product",
    regulatory: "Regulatory",
    analyst: "Analyst",
    macro_sector: "Sector",
    other: "Other",
    unclear: "Unclear",
  };
  return map[cat];
}

function categoryClass(cat: SipCatalystCategory): string {
  const map: Record<SipCatalystCategory, string> = {
    earnings: "badge-earnings",
    guidance: "badge-guidance-neu",
    m_and_a: "badge-mna",
    partnership: "badge-deal",
    product: "badge-product",
    regulatory: "badge-reg",
    analyst: "badge-analyst",
    macro_sector: "badge-sector",
    other: "badge-other",
    unclear: "badge-unclear",
  };
  return map[cat];
}

/** Badge row for SIP grid: CSS class + short label (spec catalyst badges). */
export function sipCatalystBadge(c: SipCatalyst): SipBadgeToken {
  if (c.category === "guidance" && c.guidance_tone) {
    return {
      className: guidanceClass(c.guidance_tone),
      label: `Guidance · ${c.guidance_tone}`,
    };
  }
  return {
    className: categoryClass(c.category),
    label: categoryLabel(c.category),
  };
}
