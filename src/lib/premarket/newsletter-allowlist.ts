import { readFileSync } from "fs";
import { join } from "path";

const DEFAULT_RELATIVE_PATH = join("config", "newsletters-for-writeups.txt");

/**
 * Last-resort allowlist when `config/newsletters-for-writeups.txt` is missing at runtime
 * (common with `output: "standalone"` / minimal deploy bundles). **Keep in sync** with that file.
 */
const EMBEDDED_NEWSLETTER_ALLOWLIST = `Newsletters for writeups

crew@morningbrew.com
updates@vitalknowledge.net
thetranscript@substack.com
thebearcave@substack.com
citrini@substack.com
doomberg@substack.com
urbankaoboy@substack.com
unusualwhales@substack.com
benzinga@substack.com
michaeljburry@substack.com
capitalflows@substack.com
`;

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

/**
 * Load allowlist: optional env `NEWSLETTER_ALLOWLIST` (comma-separated) for production overrides,
 * else `config/newsletters-for-writeups.txt` from cwd, else embedded copy.
 */
export function loadNewsletterAllowlistFromRepo(relativePath = DEFAULT_RELATIVE_PATH): string[] {
  const fromEnv = process.env.NEWSLETTER_ALLOWLIST?.trim();
  if (fromEnv) {
    return parseNewsletterAllowlistText(fromEnv.replace(/,/g, "\n"));
  }
  const abs = join(process.cwd(), relativePath);
  try {
    const raw = readFileSync(abs, "utf8");
    return parseNewsletterAllowlistText(raw);
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      return parseNewsletterAllowlistText(EMBEDDED_NEWSLETTER_ALLOWLIST);
    }
    throw e;
  }
}
