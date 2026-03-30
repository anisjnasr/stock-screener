import { existsSync } from "fs";
import { join } from "path";

const RENDER_DISK_DATA = "/app/data";

/**
 * Resolve the data directory. Searches in order:
 *  1. SCREENER_DATA_DIR env var (explicit override)
 *  2. {cwd}/data  — works in dev and Docker (WORKDIR /app)
 *  3. /app/data   — Render persistent disk (native Node runtime where cwd != /app)
 * The first path that contains screener.db wins; otherwise returns {cwd}/data.
 */
export function getDataDir(): string {
  const envDir = process.env.SCREENER_DATA_DIR?.trim();
  if (envDir) return envDir;

  const cwdData = join(process.cwd(), "data");
  if (existsSync(join(cwdData, "screener.db"))) return cwdData;
  if (existsSync(join(RENDER_DISK_DATA, "screener.db"))) return RENDER_DISK_DATA;
  return cwdData;
}

/**
 * Resolve the screener DB file path.
 *  1. SCREENER_DB_PATH env var
 *  2. {resolved data dir}/screener.db
 */
export function getScreenerDbPath(): string {
  const envPath = process.env.SCREENER_DB_PATH?.trim();
  if (envPath) return envPath;
  return join(getDataDir(), "screener.db");
}

/**
 * Resolves a data file path. Checks `data/` first (works in dev and when
 * Render disk has the file), then falls back to `static-data/` (Docker image
 * where the Render persistent disk hides files COPY'd to /app/data/).
 */
export function resolveDataPath(filename: string): string {
  const dataDir = getDataDir();
  const primary = join(dataDir, filename);
  if (existsSync(primary)) return primary;
  const cwdPrimary = join(process.cwd(), "data", filename);
  if (cwdPrimary !== primary && existsSync(cwdPrimary)) return cwdPrimary;
  const fallback = join(process.cwd(), "static-data", filename);
  if (existsSync(fallback)) return fallback;
  return primary;
}
