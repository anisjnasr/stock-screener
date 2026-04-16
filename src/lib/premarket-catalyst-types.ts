/**
 * Premarket SIP catalyst: AI summary + category (shared client/API).
 */

export type CatalystCategory =
  | "EARNINGS"
  | "GUIDANCE"
  | "CONTRACT"
  | "CLINICAL"
  | "M_AND_A"
  | "PARTNERSHIP"
  | "UPGRADE"
  | "MANAGEMENT"
  | "UNKNOWN";

export type GuidanceTone = "raised" | "lowered";

export type PremarketCatalystEntry = {
  summary: string;
  category: CatalystCategory;
  guidanceTone: GuidanceTone | null;
};

const CATEGORY_ALIASES: Record<string, CatalystCategory> = {
  EARNINGS: "EARNINGS",
  GUIDANCE: "GUIDANCE",
  CONTRACT: "CONTRACT",
  CLINICAL: "CLINICAL",
  M_AND_A: "M_AND_A",
  MNA: "M_AND_A",
  "M&A": "M_AND_A",
  "M+A": "M_AND_A",
  MA: "M_AND_A",
  MERGER: "M_AND_A",
  PARTNERSHIP: "PARTNERSHIP",
  UPGRADE: "UPGRADE",
  MANAGEMENT: "MANAGEMENT",
  UNKNOWN: "UNKNOWN",
  OTHER: "UNKNOWN",
};

export function parseCatalystCategory(raw: unknown): CatalystCategory {
  if (raw == null || typeof raw !== "string") return "UNKNOWN";
  const u = raw.trim().toUpperCase();
  const k = u.replace(/\s+/g, "_").replace(/&/g, "AND");
  return CATEGORY_ALIASES[u] ?? CATEGORY_ALIASES[k] ?? "UNKNOWN";
}

export function parseGuidanceTone(raw: unknown): GuidanceTone | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "raised" || s === "up" || s === "positive") return "raised";
  if (s === "lowered" || s === "down" || s === "negative") return "lowered";
  return null;
}

export function normalizeCatalystFromApi(row: {
  summary?: unknown;
  category?: unknown;
  guidanceTone?: unknown;
} | null): PremarketCatalystEntry {
  const summary = row?.summary != null ? String(row.summary).trim() : "";
  const s = summary.length > 0 ? summary : "No news";
  return {
    summary: s,
    category: parseCatalystCategory(row?.category),
    guidanceTone: parseGuidanceTone(row?.guidanceTone),
  };
}

export function legacySummaryToEntry(summary: string): PremarketCatalystEntry {
  const t = summary.trim();
  return {
    summary: t.length > 0 ? t : "No news",
    category: "UNKNOWN",
    guidanceTone: null,
  };
}

export function catalystEntryOrStringToEntry(
  v: PremarketCatalystEntry | string | undefined | null
): PremarketCatalystEntry | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return legacySummaryToEntry(v);
  if (typeof v === "object" && v && "summary" in v) {
    return normalizeCatalystFromApi(v as PremarketCatalystEntry);
  }
  return undefined;
}

export function catalystSummaryText(v: PremarketCatalystEntry | string | undefined | null): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return v.summary ?? "";
}

export function categoryBadgeLabel(category: CatalystCategory, guidanceTone: GuidanceTone | null): string {
  if (category === "GUIDANCE" && guidanceTone === "raised") return "GUIDANCE ↑";
  if (category === "GUIDANCE" && guidanceTone === "lowered") return "GUIDANCE ↓";
  if (category === "M_AND_A") return "M&A";
  return category === "UNKNOWN" ? "—" : category.replace(/_/g, " ");
}

/** Parse localStorage JSON (v3 objects or legacy v2 string map). */
export function migrateCatalystStorageJson(parsed: unknown): Record<string, PremarketCatalystEntry> {
  const out: Record<string, PremarketCatalystEntry> = {};
  if (!parsed || typeof parsed !== "object") return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(k).toUpperCase().trim();
    if (!key) continue;
    if (typeof v === "string") {
      out[key] = legacySummaryToEntry(v);
    } else if (v && typeof v === "object") {
      out[key] = normalizeCatalystFromApi(v as PremarketCatalystEntry);
    }
  }
  return out;
}
