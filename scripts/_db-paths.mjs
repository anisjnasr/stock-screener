import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const root = join(__dirname, "..");

function resolveMaybeAbsolute(pathValue, baseDir) {
  if (!pathValue) return null;
  const raw = String(pathValue).trim();
  if (!raw) return null;
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

export const dataDir = resolveMaybeAbsolute(process.env.SCREENER_DATA_DIR, root) ?? join(root, "data");
export const dbPath = resolveMaybeAbsolute(process.env.SCREENER_DB_PATH, root) ?? join(dataDir, "screener.db");

