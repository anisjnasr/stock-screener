/** Row sort order for Large Cap Analysis panel. */

export type LargeCapRowSortInput = {
  ticker: string;
  status: "pending" | "loading" | "done" | "error";
  verdict?: Record<string, unknown>;
};

const CONF_RANK: Record<string, number> = { High: 0, Medium: 1, Med: 1, Low: 2 };
const BIAS_RANK: Record<string, number> = { Bullish: 0, Bearish: 1, Neutral: 2 };

function normalizeConfidence(raw: unknown): string {
  if (typeof raw !== "string") return "Low";
  const c = raw.trim();
  if (c === "High") return "High";
  if (c === "Medium" || c === "Med") return "Medium";
  return "Low";
}

function normalizeBias(raw: unknown): string {
  if (typeof raw !== "string") return "Neutral";
  const b = raw.trim();
  if (b === "Bullish" || b === "Bearish" || b === "Neutral") return b;
  return "Neutral";
}

function topScenario(verdict: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const scenarios = verdict?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) return null;
  const ranked = scenarios.find(
    (s) => typeof s === "object" && s != null && (s as Record<string, unknown>).rank === 1
  ) as Record<string, unknown> | undefined;
  return ranked ?? (scenarios[0] as Record<string, unknown>);
}

function scenarioConfidenceRank(verdict: Record<string, unknown> | undefined): number {
  const top = topScenario(verdict);
  if (!top) return CONF_RANK.Low;
  return CONF_RANK[normalizeConfidence(top.confidence)] ?? CONF_RANK.Low;
}

function biasRank(verdict: Record<string, unknown> | undefined): number {
  return BIAS_RANK[normalizeBias(verdict?.bias)] ?? BIAS_RANK.Neutral;
}

/** Lower tuple sorts earlier. Pending/loading/error rows sink to the bottom. */
function rowSortKey(r: LargeCapRowSortInput): [number, number, number, string] {
  if (r.status === "pending" || r.status === "loading") return [4, 0, 0, r.ticker];
  if (r.status === "error") return [3, 0, 0, r.ticker];

  const v = r.verdict?.verdict;
  if (v === "No Trade") return [2, biasRank(r.verdict), 0, r.ticker];
  if (v === "Trade") {
    return [0, scenarioConfidenceRank(r.verdict), biasRank(r.verdict), r.ticker];
  }

  return [5, 0, 0, r.ticker];
}

function compareSortKeys(a: [number, number, number, string], b: [number, number, number, string]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  return a[3].localeCompare(b[3]);
}

export function sortLargeCapRows<T extends LargeCapRowSortInput>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareSortKeys(rowSortKey(a), rowSortKey(b)));
}
