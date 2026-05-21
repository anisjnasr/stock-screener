import { formatCompsExampleOutcome } from "@/lib/premarket/large-cap-verdict-display";

export type CompLabCompOutcome = "follow_through" | "reversal" | "flat";

export type CompLabComp = {
  comp_date: string;
  next_session_date: string;
  setup_signature: string;
  similarity_score: number;
  outcome: CompLabCompOutcome;
  outcome_pct: number;
  gap_bucket: string;
  outcome_label: string;
};

export type CompLabCompsResult = {
  reference_date: string;
  analysis_date: string;
  match_count: number;
  rated_count: number;
  reference_setup_signature: string | null;
  empty_reason: string | null;
  comps: CompLabComp[];
};

const OUTCOME_MAP: Record<string, CompLabCompOutcome> = {
  follow_through: "follow_through",
  reversed: "reversal",
  neutral_chop: "flat",
};

export function mapHistoricalAnaloguesToCompLabComps(block: unknown): Omit<CompLabCompsResult, "reference_date" | "analysis_date" | "rated_count"> {
  const o = block && typeof block === "object" ? (block as Record<string, unknown>) : {};
  const matches = Array.isArray(o.matches) ? o.matches : [];
  const comps: CompLabComp[] = [];

  for (const raw of matches) {
    if (!raw || typeof raw !== "object") continue;
    const ex = raw as Record<string, unknown>;
    const compDate = String(ex.analogue_session_date || "").trim();
    if (!compDate) continue;
    const ns = ex.next_session && typeof ex.next_session === "object" ? (ex.next_session as Record<string, unknown>) : {};
    const rawLabel = String(ns.follow_through_label || "");
    const outcome = OUTCOME_MAP[rawLabel] ?? "flat";
    const outcomePct = typeof ns.close_vs_open_pct === "number" ? ns.close_vs_open_pct : 0;
    comps.push({
      comp_date: compDate,
      next_session_date: String(ex.next_session_date || ""),
      setup_signature: String(ex.setup_signature || "—"),
      similarity_score: typeof ex.similarity_score === "number" ? ex.similarity_score : 100,
      outcome,
      outcome_pct: outcomePct,
      gap_bucket: String(ex.gap_bucket_used_for_match || ""),
      outcome_label: formatCompsExampleOutcome(outcome, outcomePct),
    });
  }

  return {
    match_count: typeof o.match_count === "number" ? o.match_count : comps.length,
    reference_setup_signature:
      typeof o.reference_setup_signature === "string" ? o.reference_setup_signature : null,
    empty_reason: typeof o.empty_reason === "string" ? o.empty_reason : null,
    comps,
  };
}

export type CompLabSortMode = "similarity" | "recent";

export function sortCompLabComps(comps: CompLabComp[], mode: CompLabSortMode): CompLabComp[] {
  const next = comps.slice();
  if (mode === "recent") {
    next.sort((a, b) => b.comp_date.localeCompare(a.comp_date));
    return next;
  }
  next.sort((a, b) => {
    if (b.similarity_score !== a.similarity_score) return b.similarity_score - a.similarity_score;
    return b.comp_date.localeCompare(a.comp_date);
  });
  return next;
}

export const COMP_LAB_PAGE_SIZE = 10;
