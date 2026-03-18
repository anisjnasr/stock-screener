#!/usr/bin/env node
/**
 * Reliable refresh pipeline:
 * - copy active DB to staged DB
 * - run selected refresh scripts against staged DB
 * - verify staged DB health
 * - atomically swap staged DB into place
 *
 * This avoids exposing partially refreshed data and prevents failed runs from
 * overwriting the production DB.
 *
 * Usage examples:
 *   npm run refresh-safe
 *   npm run refresh-safe -- --skip-daily --ownership-latest-only
 *   npm run refresh-safe -- --skip-ownership
 */

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import Database from "better-sqlite3";
import { dataDir, dbPath, root } from "./_db-paths.mjs";

const args = new Set(process.argv.slice(2));
const SKIP_DAILY = args.has("--skip-daily");
const SKIP_FINANCIALS = args.has("--skip-financials");
const SKIP_OWNERSHIP = args.has("--skip-ownership");
const OWNERSHIP_LATEST_ONLY = args.has("--ownership-latest-only");

const LOCK_PATH = join(dataDir, "refresh-safe.lock");
const STAGED_DB_PATH = join(dataDir, "screener.staged.db");
const STAGED_OLD_PATH = join(dataDir, "screener.previous.db");
const BACKUP_DIR = join(dataDir, "backups");

function runNodeScript(relativeScriptPath, extraArgs = [], targetDbPath = STAGED_DB_PATH) {
  const scriptPath = join(root, relativeScriptPath);
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      SCREENER_DB_PATH: targetDbPath,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${relativeScriptPath} failed with status ${result.status ?? "unknown"}`);
  }
}

function verifyStagedDb(targetDbPath) {
  const db = new Database(targetDbPath, { readonly: true });
  try {
    const latestQuoteDate = String(db.prepare("SELECT MAX(date) AS d FROM quote_daily").get()?.d ?? "");
    if (!latestQuoteDate) {
      throw new Error("Verification failed: staged DB has no quote_daily data.");
    }

    const financialsRows = Number(db.prepare("SELECT COUNT(*) AS c FROM financials").get()?.c ?? 0);
    const ownershipRows = Number(db.prepare("SELECT COUNT(*) AS c FROM ownership").get()?.c ?? 0);
    const latestOwnershipDate = String(db.prepare("SELECT MAX(report_date) AS d FROM ownership").get()?.d ?? "");
    const latestOwnershipSymbols = latestOwnershipDate
      ? Number(
          db
            .prepare("SELECT COUNT(DISTINCT symbol) AS c FROM ownership WHERE report_date = ?")
            .get(latestOwnershipDate)?.c ?? 0
        )
      : 0;

    if (!SKIP_FINANCIALS && financialsRows <= 0) {
      throw new Error("Verification failed: staged DB has zero financials rows after refresh.");
    }
    if (!SKIP_OWNERSHIP && ownershipRows <= 0) {
      throw new Error("Verification failed: staged DB has zero ownership rows after refresh.");
    }

    if (!SKIP_OWNERSHIP) {
      const minSymbols = Number(process.env.OWNERSHIP_MIN_SYMBOLS ?? 500);
      if (latestOwnershipSymbols < minSymbols) {
        throw new Error(
          `Verification failed: latest ownership coverage too low (${latestOwnershipSymbols} < ${minSymbols}).`
        );
      }
    }

    console.log(
      "Verification passed:",
      JSON.stringify(
        {
          latestQuoteDate,
          financialsRows,
          ownershipRows,
          latestOwnershipDate: latestOwnershipDate || null,
          latestOwnershipSymbols,
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

async function promoteStagedDb() {
  // Fast path: atomic rename swap (works when file is not locked).
  try {
    rmSync(STAGED_OLD_PATH, { force: true });
    renameSync(dbPath, STAGED_OLD_PATH);
    renameSync(STAGED_DB_PATH, dbPath);
    rmSync(STAGED_OLD_PATH, { force: true });
    return { method: "rename" };
  } catch (err) {
    // Fallback for environments where the active DB file is locked by a running process
    // (e.g. local dev on Windows). Use SQLite backup API to overwrite in place.
    console.warn(
      "Rename swap failed, falling back to in-place SQLite backup:",
      err instanceof Error ? err.message : err
    );
  }

  const stagedDb = new Database(STAGED_DB_PATH, { readonly: true });
  try {
    await stagedDb.backup(dbPath);
  } finally {
    stagedDb.close();
  }
  return { method: "sqlite-backup" };
}

function ensureLock() {
  if (existsSync(LOCK_PATH)) {
    throw new Error(`Another refresh appears to be running (lock exists at ${LOCK_PATH}).`);
  }
  writeFileSync(LOCK_PATH, `${new Date().toISOString()}\n`, "utf8");
}

function clearLock() {
  try {
    rmSync(LOCK_PATH, { force: true });
  } catch {
    // ignore
  }
}

async function main() {
  if (!existsSync(dbPath)) {
    throw new Error(`Missing active DB at ${dbPath}`);
  }
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(BACKUP_DIR, { recursive: true });

  ensureLock();
  try {
    console.log("1) Staging DB copy...");
    rmSync(STAGED_DB_PATH, { force: true });
    copyFileSync(dbPath, STAGED_DB_PATH);

    console.log("2) Running refresh scripts on staged DB...");
    if (!SKIP_DAILY) runNodeScript("scripts/refresh-daily.mjs");
    if (!SKIP_FINANCIALS) runNodeScript("scripts/refresh-financials.mjs");
    if (!SKIP_OWNERSHIP) {
      const ownershipArgs = OWNERSHIP_LATEST_ONLY ? ["--latest-only"] : [];
      runNodeScript("scripts/refresh-ownership.mjs", ownershipArgs);
      runNodeScript("scripts/check-ownership-refresh.mjs");
    }

    console.log("3) Verifying staged DB...");
    verifyStagedDb(STAGED_DB_PATH);

    console.log("4) Swapping staged DB into place...");
    const backupPath = join(BACKUP_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-screener.db`);
    copyFileSync(dbPath, backupPath);
    const promoted = await promoteStagedDb();

    console.log("Refresh-safe pipeline complete.");
    console.log("Backup saved at:", backupPath);
    console.log("Promotion method:", promoted.method);
  } finally {
    clearLock();
    rmSync(STAGED_DB_PATH, { force: true });
  }
}

try {
  await main();
} catch (err) {
  console.error("refresh-safe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

