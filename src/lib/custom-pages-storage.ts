import { cloudSyncSetting } from "./cloud-sync";

const STORAGE_KEY_CUSTOM_PAGES = "stock-research-custom-pages";

export type CustomPage = {
  id: string;
  name: string;
  aiModel: "sonnet" | "opus";
  dataSources: ("database" | "web")[];
  dataLookback: "1y" | "5y" | "";
  prompt: string;
  createdAt: string;
};

function sanitizePage(input: Partial<CustomPage>): CustomPage {
  const dataSourcesRaw = Array.isArray(input.dataSources) ? input.dataSources : [];
  const dataSources = dataSourcesRaw
    .filter((x): x is "database" | "web" => x === "database" || x === "web");
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id : crypto.randomUUID(),
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : "New AI page",
    aiModel: input.aiModel === "opus" ? "opus" : "sonnet",
    dataSources: dataSources.length > 0 ? dataSources : ["database"],
    dataLookback: input.dataLookback === "1y" || input.dataLookback === "5y" ? input.dataLookback : "",
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
  };
}

export function loadCustomPages(): CustomPage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_PAGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => sanitizePage(p as Partial<CustomPage>));
  } catch {
    return [];
  }
}

export function saveCustomPages(pages: CustomPage[]): void {
  if (typeof window === "undefined") return;
  const normalized = pages.map((p) => sanitizePage(p));
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_PAGES, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
  queueMicrotask(() => {
    try {
      window.dispatchEvent(new CustomEvent("stock-custom-pages-changed", { detail: normalized }));
    } catch {
      /* ignore */
    }
  });
  cloudSyncSetting("custom_pages", normalized);
}

export function createCustomPage(input: Omit<CustomPage, "id" | "createdAt">): CustomPage {
  const pages = loadCustomPages();
  const newPage = sanitizePage({
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  pages.push(newPage);
  saveCustomPages(pages);
  return newPage;
}

export function updateCustomPage(id: string, updates: Partial<Omit<CustomPage, "id" | "createdAt">>): void {
  const pages = loadCustomPages();
  const idx = pages.findIndex((p) => p.id === id);
  if (idx < 0) return;
  pages[idx] = sanitizePage({ ...pages[idx], ...updates, id: pages[idx]!.id, createdAt: pages[idx]!.createdAt });
  saveCustomPages(pages);
}

export function deleteCustomPage(id: string): void {
  const pages = loadCustomPages().filter((p) => p.id !== id);
  saveCustomPages(pages);
}

export const CUSTOM_PAGES_STORAGE_KEY = STORAGE_KEY_CUSTOM_PAGES;
