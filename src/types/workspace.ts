export type WorkspaceSection = "market" | "sectors-industries" | "scans" | "lists";

export const WORKSPACE_SECTIONS: { id: WorkspaceSection; label: string; shortLabel: string; key: string }[] = [
  { id: "market", label: "Market", shortLabel: "Market", key: "1" },
  { id: "sectors-industries", label: "Sectors / Industries", shortLabel: "Sectors", key: "2" },
  { id: "scans", label: "Scans", shortLabel: "Scans", key: "3" },
  { id: "lists", label: "Lists", shortLabel: "Lists", key: "4" },
];
