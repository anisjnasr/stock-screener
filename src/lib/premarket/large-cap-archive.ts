/** Trade forward-test archive row (Supabase `large_cap_trade_archive`). */

export type LargeCapArchiveOutcome =
  | "Scenario 1"
  | "Scenario 2"
  | "Scenario 3"
  | "None"
  | "Ambiguous"
  | "Pending";

export type LargeCapArchiveRow = {
  ticker: string;
  trading_date: string;
  result_json: Record<string, unknown>;
  outcome: string | null;
  scoring_json: Record<string, unknown> | null;
  scored: boolean;
  outcome_scored_at: string | null;
  logged_at: string;
  updated_at: string;
};

export type LargeCapArchiveFilters = {
  ticker: string;
  dateFrom: string;
  dateTo: string;
  outcome: "" | LargeCapArchiveOutcome;
};

export const ARCHIVE_OUTCOME_OPTIONS: { value: "" | LargeCapArchiveOutcome; label: string }[] = [
  { value: "", label: "All outcomes" },
  { value: "Pending", label: "Pending" },
  { value: "Scenario 1", label: "Scenario 1" },
  { value: "Scenario 2", label: "Scenario 2" },
  { value: "Scenario 3", label: "Scenario 3" },
  { value: "None", label: "None" },
  { value: "Ambiguous", label: "Ambiguous" },
];

export function archiveRowKey(row: LargeCapArchiveRow): string {
  return `${row.trading_date}|${row.ticker}`;
}

export function resolveArchiveOutcome(row: LargeCapArchiveRow): LargeCapArchiveOutcome {
  if (!row.scored || row.outcome == null || row.outcome === "") return "Pending";
  const o = row.outcome.trim();
  if (
    o === "Scenario 1" ||
    o === "Scenario 2" ||
    o === "Scenario 3" ||
    o === "None" ||
    o === "Ambiguous"
  ) {
    return o;
  }
  return "Pending";
}

export function formatArchiveDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatPrice(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function scenarioHighlightRank(
  outcome: LargeCapArchiveOutcome
): 1 | 2 | 3 | null {
  if (outcome === "Scenario 1") return 1;
  if (outcome === "Scenario 2") return 2;
  if (outcome === "Scenario 3") return 3;
  return null;
}

export function compactScenarioLabel(sc: Record<string, unknown>): string {
  const title = String(sc.title ?? sc.description ?? "Scenario").trim();
  const conf = String(sc.confidence ?? "Med");
  const confShort = conf === "Medium" ? "Med" : conf;
  return `${title} (${confShort})`;
}

export function filterArchiveRows(
  rows: LargeCapArchiveRow[],
  filters: LargeCapArchiveFilters
): LargeCapArchiveRow[] {
  const sym = filters.ticker.trim().toUpperCase();
  const from = filters.dateFrom.trim();
  const to = filters.dateTo.trim();
  const outcomeFilter = filters.outcome;

  return rows.filter((row) => {
    if (sym && row.ticker.toUpperCase() !== sym) return false;
    if (from && row.trading_date < from) return false;
    if (to && row.trading_date > to) return false;
    if (outcomeFilter && resolveArchiveOutcome(row) !== outcomeFilter) return false;
    return true;
  });
}

export type ArchiveForwardTestStats = {
  resolved: number;
  playedOut: number;
  hitRatePct: number | null;
  ambiguous: number;
  pending: number;
};

/** Hit rate excludes Pending and Ambiguous (blueprint §11e). */
export function computeForwardTestStats(rows: LargeCapArchiveRow[]): ArchiveForwardTestStats {
  let resolved = 0;
  let playedOut = 0;
  let ambiguous = 0;
  let pending = 0;

  for (const row of rows) {
    const o = resolveArchiveOutcome(row);
    if (o === "Pending") {
      pending += 1;
      continue;
    }
    if (o === "Ambiguous") {
      ambiguous += 1;
      continue;
    }
    resolved += 1;
    if (o === "Scenario 1" || o === "Scenario 2" || o === "Scenario 3") {
      playedOut += 1;
    }
  }

  return {
    resolved,
    playedOut,
    hitRatePct: resolved > 0 ? Math.round((playedOut / resolved) * 100) : null,
    ambiguous,
    pending,
  };
}
