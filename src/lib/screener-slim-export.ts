/**
 * Build a slim screener.db for the Python Large Cap service (~300–800 MB vs ~6 GB full).
 * Keeps only tables digest_builder reads, trimmed to recent sessions.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir, getScreenerDbPath } from "@/lib/data-path";

/** Trading sessions of history — covers 180-day windows + analogue scan with margin. */
export const LARGE_CAP_EXPORT_SESSION_LOOKBACK = 320;

const SLIM_FILENAME = "screener-large-cap-export.db";
const META_FILENAME = "screener-large-cap-export.meta.json";

type SlimMeta = {
  sourceLatest: string;
  sourceSize: number;
  sourceMtimeMs: number;
  sessionLookback: number;
  cutoffDate: string;
  builtAt: string;
};

function metaPath(): string {
  return join(getDataDir(), META_FILENAME);
}

function slimPath(): string {
  return join(getDataDir(), SLIM_FILENAME);
}

function readMeta(): SlimMeta | null {
  const p = metaPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SlimMeta;
  } catch {
    return null;
  }
}

function sourceFingerprint(): { latest: string; size: number; mtimeMs: number } | null {
  const srcPath = getScreenerDbPath();
  if (!existsSync(srcPath)) return null;
  const db = new Database(srcPath, { readonly: true });
  try {
    const row = db.prepare("SELECT MAX(date) AS latest FROM daily_bars").get() as
      | { latest: string | null }
      | undefined;
    const latest = String(row?.latest ?? "");
    if (!latest) return null;
    const st = statSync(srcPath);
    return { latest, size: st.size, mtimeMs: st.mtimeMs };
  } finally {
    db.close();
  }
}

function metaMatches(meta: SlimMeta, fp: { latest: string; size: number; mtimeMs: number }): boolean {
  return (
    meta.sourceLatest === fp.latest &&
    meta.sourceSize === fp.size &&
    meta.sourceMtimeMs === fp.mtimeMs &&
    meta.sessionLookback === LARGE_CAP_EXPORT_SESSION_LOOKBACK &&
    existsSync(slimPath())
  );
}

/** Return path to cached slim export, rebuilding when the main screener.db changes. */
export function ensureLargeCapSlimExportDb(): string {
  const fp = sourceFingerprint();
  if (!fp) {
    throw new Error("Main screener.db is missing or has no daily_bars");
  }

  const existing = readMeta();
  if (existing && metaMatches(existing, fp)) {
    return slimPath();
  }

  const srcPath = getScreenerDbPath();
  const outPath = slimPath();
  const tmpPath = `${outPath}.building`;

  rmSync(tmpPath, { force: true });
  rmSync(outPath, { force: true });

  const src = new Database(srcPath, { readonly: true });
  let cutoffDate = "";
  try {
    const cutoffRow = src
      .prepare(
        `
        SELECT MIN(d) AS cutoff FROM (
          SELECT date AS d FROM daily_bars GROUP BY date ORDER BY date DESC LIMIT ?
        )
        `
      )
      .get(LARGE_CAP_EXPORT_SESSION_LOOKBACK) as { cutoff: string | null } | undefined;
    cutoffDate = String(cutoffRow?.cutoff ?? fp.latest);
    if (!cutoffDate) cutoffDate = fp.latest;
  } finally {
    src.close();
  }

  const dst = new Database(tmpPath);
  try {
    const attachPath = srcPath.replace(/\\/g, "/").replace(/'/g, "''");
    dst.exec(`ATTACH DATABASE '${attachPath}' AS src`);

    dst.exec("CREATE TABLE companies AS SELECT * FROM src.companies");
    dst.exec(
      `CREATE TABLE daily_bars AS SELECT * FROM src.daily_bars WHERE date >= '${cutoffDate}'`
    );
    dst.exec(
      `CREATE TABLE indicators_daily AS SELECT * FROM src.indicators_daily WHERE date >= '${cutoffDate}'`
    );
    dst.exec(
      `CREATE TABLE quote_daily AS SELECT * FROM src.quote_daily WHERE date >= '${cutoffDate}'`
    );

    dst.exec("CREATE INDEX idx_daily_bars_symbol_date ON daily_bars(symbol, date)");
    dst.exec("CREATE INDEX idx_indicators_daily_symbol_date ON indicators_daily(symbol, date)");
    dst.exec("CREATE INDEX idx_quote_daily_symbol_date ON quote_daily(symbol, date)");

    dst.exec("DETACH src");
    dst.exec("PRAGMA optimize");
  } finally {
    dst.close();
  }

  const built = statSync(tmpPath);
  if (!built.isFile() || built.size <= 0) {
    rmSync(tmpPath, { force: true });
    throw new Error("Slim export produced an empty database");
  }

  renameSync(tmpPath, outPath);

  const meta: SlimMeta = {
    sourceLatest: fp.latest,
    sourceSize: fp.size,
    sourceMtimeMs: fp.mtimeMs,
    sessionLookback: LARGE_CAP_EXPORT_SESSION_LOOKBACK,
    cutoffDate,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(metaPath(), JSON.stringify(meta, null, 2), "utf8");
  return outPath;
}
