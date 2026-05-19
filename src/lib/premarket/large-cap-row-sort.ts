/** Row sort order for Large Cap Analysis panel (Trade above No Trade). */

export type LargeCapRowSortInput = {
  ticker: string;
  status: "pending" | "loading" | "done" | "error";
  verdict?: Record<string, unknown>;
};

const CONF_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function scenarioConfidenceRank(verdict: Record<string, unknown> | undefined): number {
  const scenarios = verdict?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) return 99;
  const first = scenarios[0] as Record<string, unknown>;
  const conf = typeof first.confidence === "string" ? first.confidence : "Low";
  return CONF_RANK[conf] ?? 2;
}

function rowRank(r: LargeCapRowSortInput): number {
  if (r.status === "pending" || r.status === "loading") return 4;
  const v = r.verdict?.verdict;
  if (v === "Trade") return scenarioConfidenceRank(r.verdict);
  if (v === "No Trade") return 3;
  return 5;
}

export function sortLargeCapRows<T extends LargeCapRowSortInput>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = rowRank(a);
    const rb = rowRank(b);
    if (ra !== rb) return ra - rb;
    return a.ticker.localeCompare(b.ticker);
  });
}
