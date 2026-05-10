export function formatUniverseBreadthPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${n.toFixed(1)}%`;
}

export function getUniverseBreadthFloorClass(value: number | null | undefined, floor: number, inclusive: boolean): string {
  if (value == null || !Number.isFinite(value)) return "";
  return inclusive ? (value <= floor ? "ws-mm-heat-red-strong" : "") : (value < floor ? "ws-mm-heat-red-strong" : "");
}
