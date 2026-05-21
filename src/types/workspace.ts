export type BaseWorkspaceSection =
  | "market"
  | "sectors-industries"
  | "scans"
  | "lists"
  | "pre-market"
  | "comp-lab";
export type WorkspaceSection = BaseWorkspaceSection;

export const WORKSPACE_SECTIONS: { id: BaseWorkspaceSection; label: string; shortLabel: string; key: string }[] = [
  { id: "market", label: "Market", shortLabel: "Market", key: "1" },
  { id: "sectors-industries", label: "INDUSTRIES", shortLabel: "Industries", key: "2" },
  { id: "scans", label: "Scans", shortLabel: "Scans", key: "3" },
  { id: "lists", label: "Lists", shortLabel: "Lists", key: "4" },
  { id: "pre-market", label: "PRE-MARKET", shortLabel: "Pre", key: "5" },
  { id: "comp-lab", label: "COMP LAB", shortLabel: "Comp", key: "6" },
];
