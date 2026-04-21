import { readFileSync } from "fs";
import { join } from "path";

const DEFAULT_RELATIVE_PATH = join("config", "newsletters-for-writeups.txt");

/**
 * Allowed newsletter sender emails for macro writeup ingestion (Phase 4).
 * One address per line; lines without `@` are ignored. Case-insensitive.
 */
export function parseNewsletterAllowlistText(raw: string): string[] {
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim().toLowerCase();
    if (!t || !t.includes("@")) continue;
    out.add(t);
  }
  return [...out].sort();
}

export function loadNewsletterAllowlistFromRepo(relativePath = DEFAULT_RELATIVE_PATH): string[] {
  const abs = join(process.cwd(), relativePath);
  const raw = readFileSync(abs, "utf8");
  return parseNewsletterAllowlistText(raw);
}
