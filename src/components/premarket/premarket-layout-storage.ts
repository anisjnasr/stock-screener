export const PREMARKET_LAYOUT_LS_KEY = "stockstalker-premarket-layout-v1";

export const PREMARKET_SECTION_IDS = ["context", "largeCap", "earnings"] as const;
export type PremarketSectionId = (typeof PREMARKET_SECTION_IDS)[number];

export type PremarketLayoutState = {
  version: 1;
  collapsed_sections: Record<PremarketSectionId, boolean>;
};

function expandedDefaults(): Record<PremarketSectionId, boolean> {
  return {
    context: false,
    largeCap: false,
    earnings: false,
  };
}

export function getDefaultLayout(): PremarketLayoutState {
  return { version: 1, collapsed_sections: expandedDefaults() };
}

function isSectionId(k: string): k is PremarketSectionId {
  return (PREMARKET_SECTION_IDS as readonly string[]).includes(k);
}

export function parseLayout(raw: string | null): PremarketLayoutState | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1) return null;
    const cs = o.collapsed_sections;
    if (!cs || typeof cs !== "object") return null;
    const merged = expandedDefaults();
    for (const [k, v] of Object.entries(cs as Record<string, unknown>)) {
      if (isSectionId(k) && typeof v === "boolean") merged[k] = v;
    }
    return { version: 1, collapsed_sections: merged };
  } catch {
    return null;
  }
}
