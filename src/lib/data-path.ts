import { existsSync } from "fs";
import { join } from "path";

/**
 * Resolves a data file path. Checks `data/` first (works in dev and when
 * Render disk has the file), then falls back to `static-data/` (Docker image
 * where the Render persistent disk hides files COPY'd to /app/data/).
 */
export function resolveDataPath(filename: string): string {
  const primary = join(process.cwd(), "data", filename);
  if (existsSync(primary)) return primary;
  const fallback = join(process.cwd(), "static-data", filename);
  if (existsSync(fallback)) return fallback;
  return primary;
}
