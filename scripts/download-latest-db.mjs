#!/usr/bin/env node
/**
 * Download the latest screener-db artifact from GitHub Actions and save it locally.
 * Replaces the old local refresh pipeline with a simple artifact download that
 * produces a byte-identical copy of the production database.
 *
 * Requires: gh CLI authenticated (run `gh auth login` once).
 *
 * Usage:
 *   node scripts/download-latest-db.mjs              # download + set as active DB
 *   node scripts/download-latest-db.mjs --backup-only # download to backups dir only
 *
 * Run: node scripts/download-latest-db.mjs
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const DB_PATH = join(DATA_DIR, "screener.db");
const REPO = "anisjnasr/stock-screener";
const KEEP_DAYS = 14;

const backupOnly = process.argv.includes("--backup-only");

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function cleanOldBackups() {
  if (!existsSync(BACKUP_DIR)) return;
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const files = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("screener-") && f.endsWith(".db"));
  let removed = 0;
  for (const file of files) {
    const filePath = join(BACKUP_DIR, file);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        removed++;
      }
    } catch {
      // ignore
    }
  }
  if (removed > 0) console.log(`Cleaned up ${removed} backup(s) older than ${KEEP_DAYS} days`);
}

function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(BACKUP_DIR, { recursive: true });

  // Verify gh CLI is available and authenticated
  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    console.error("Error: gh CLI not authenticated. Run `gh auth login` first.");
    process.exit(1);
  }

  console.log("Finding latest screener-db artifact...");

  let artifactName;
  try {
    const listOutput = execSync(
      `gh api repos/${REPO}/actions/artifacts --jq ".artifacts[] | select(.name | startswith(\\"screener-db-\\")) | select(.expired == false) | .name" -q .`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const names = listOutput.trim().split("\n").filter(Boolean);
    if (names.length === 0) {
      console.error("No unexpired screener-db artifacts found.");
      process.exit(1);
    }
    artifactName = names[0];
  } catch {
    // Fallback: use gh run download which auto-finds latest
    artifactName = null;
  }

  const tmpDir = join(DATA_DIR, ".download-tmp");
  mkdirSync(tmpDir, { recursive: true });

  console.log(`Downloading artifact${artifactName ? ` "${artifactName}"` : ""}...`);
  try {
    if (artifactName) {
      execSync(`gh run download -R ${REPO} -n "${artifactName}" -D "${tmpDir}"`, {
        stdio: "inherit",
      });
    } else {
      execSync(`gh run download -R ${REPO} -n screener-db -D "${tmpDir}"`, {
        stdio: "inherit",
      });
    }
  } catch (err) {
    console.error("Download failed. Make sure you have access to the repository.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const downloadedDb = join(tmpDir, "screener.db");
  if (!existsSync(downloadedDb)) {
    console.error(`Expected ${downloadedDb} but file not found after download.`);
    process.exit(1);
  }

  const sizeMb = Math.round(statSync(downloadedDb).size / 1024 / 1024);
  console.log(`Downloaded: ${sizeMb} MB`);

  // Save as dated backup
  const backupPath = join(BACKUP_DIR, `screener-${dateStamp()}.db`);
  copyFileSync(downloadedDb, backupPath);
  console.log(`Backup saved: ${backupPath}`);

  if (!backupOnly) {
    // Remove stale WAL/SHM files before replacing
    for (const ext of ["-wal", "-shm"]) {
      const p = DB_PATH + ext;
      if (existsSync(p)) unlinkSync(p);
    }
    copyFileSync(downloadedDb, DB_PATH);
    console.log(`Active DB updated: ${DB_PATH}`);
  }

  // Cleanup temp
  try {
    unlinkSync(downloadedDb);
    readdirSync(tmpDir).forEach((f) => unlinkSync(join(tmpDir, f)));
    // rmdir only works on empty dirs
    try { execSync(`rmdir "${tmpDir}"`, { stdio: "pipe" }); } catch { /* ok */ }
  } catch {
    // best effort
  }

  cleanOldBackups();
  console.log("Done.");
}

main();
