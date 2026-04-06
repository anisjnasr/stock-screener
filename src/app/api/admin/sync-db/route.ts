import { NextRequest, NextResponse } from "next/server";
import {
  statSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { exec } from "child_process";
import Database from "better-sqlite3";
import { resetDbConnection } from "@/lib/screener-db-native";
import { getDataDir, getScreenerDbPath } from "@/lib/data-path";

const DATA_DIR = getDataDir();
const DB_PATH = getScreenerDbPath();
const GITHUB_REPO = "anisjnasr/stock-screener";

const STALE_CACHES = [
  "market-monitor-cache.json",
  "sectors-industries-cache.json",
  "breadth-cache.json",
];

type Artifact = {
  id: number;
  name: string;
  archive_download_url: string;
  expired: boolean;
  created_at: string;
  size_in_bytes: number;
};

function log(msg: string) {
  console.log(`[sync-db] ${msg}`);
}

/**
 * Trigger-based DB sync. GH Actions calls this with a small request (no body);
 * the endpoint looks up the latest artifact from the GitHub API, then spawns a
 * background shell process: curl downloads the ZIP to disk, then unzip -p
 * extracts screener.db. Requires ~7 GB peak disk (ZIP + extracted DB).
 *
 * Requirements on the Docker image: curl, libarchive-tools (bsdtar).
 * Requirements on Render env: ADMIN_SECRET, GITHUB_TOKEN (PAT with repo scope).
 */
export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const githubToken = process.env.GITHUB_TOKEN;

  const auth = request.headers.get("authorization");
  if (!adminSecret || auth !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!githubToken) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN not configured on Render" },
      { status: 500 }
    );
  }

  mkdirSync(DATA_DIR, { recursive: true });

  try {
    log("Fetching artifact list from GitHub...");
    const listRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/artifacts?per_page=20`,
      {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!listRes.ok) {
      const text = await listRes.text();
      return NextResponse.json(
        { error: `GitHub API ${listRes.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const listData = (await listRes.json()) as { artifacts: Artifact[] };
    const artifact = listData.artifacts?.find(
      (a) => a.name.startsWith("screener-db-") && !a.expired
    );
    if (!artifact) {
      return NextResponse.json(
        { error: "No unexpired screener-db artifact found" },
        { status: 404 }
      );
    }

    const sizeMb = Math.round(artifact.size_in_bytes / 1024 / 1024);
    log(
      `Found artifact: ${artifact.name} (${sizeMb}MB, created ${artifact.created_at})`
    );

    const cacheRm = STALE_CACHES.map(
      (c) => `rm -f "${join(DATA_DIR, c)}"`
    ).join("\n");
    const tmpZip = join(DATA_DIR, "artifact.zip");

    // Two-step sync with rollback protection:
    //   1) Download artifact zip
    //   2) Extract to temp and stage DB
    //   3) Validate staged DB header + integrity + core table sanity
    //   4) Atomically move staged DB into place
    //   5) Validate live DB; rollback from backup if validation fails
    //   6) Prune old backups
    const script = [
      `set -eu`,
      `echo "[sync] Tool check:"`,
      `echo "  curl: $(which curl 2>&1 || echo NOT FOUND)"`,
      `echo "  bsdtar: $(which bsdtar 2>&1 || echo NOT FOUND)"`,
      `echo "  unzip: $(which unzip 2>&1 || echo NOT FOUND)"`,
      `echo "[sync] $(date -u) Starting sync for ${artifact.name}..."`,
      `BACKUP_DIR="${DATA_DIR}/backups"`,
      `mkdir -p "$BACKUP_DIR"`,
      `TS=$(date -u +%Y%m%d-%H%M%S)`,
      `OLD_DB_BACKUP=""`,
      `if [ -f "${DB_PATH}" ]; then`,
      `  OLD_DB_BACKUP="$BACKUP_DIR/screener.db.before-sync.$TS"`,
      `  cp -f "${DB_PATH}" "$OLD_DB_BACKUP"`,
      `  echo "[sync] Backup created: $OLD_DB_BACKUP"`,
      `fi`,
      `rm -f "${tmpZip}"`,
      `rm -f "${DB_PATH}-wal"`,
      `rm -f "${DB_PATH}-shm"`,
      cacheRm,
      `echo "[sync] Downloading artifact ZIP..."`,
      `curl -fSL --max-time 900 \\`,
      `  -H "Authorization: token $SYNC_TOKEN" \\`,
      `  -o "${tmpZip}" "$SYNC_URL"`,
      `ZIP_SIZE=$(du -m "${tmpZip}" | cut -f1)`,
      `echo "[sync] $(date -u) ZIP downloaded: \${ZIP_SIZE}MB"`,
      `EXTRACT_TMP="${DATA_DIR}/.extract-tmp"`,
      `rm -rf "$EXTRACT_TMP"`,
      `mkdir -p "$EXTRACT_TMP"`,
      `if command -v bsdtar >/dev/null 2>&1; then`,
      `  echo "[sync] Extracting with bsdtar..."`,
      `  bsdtar xf "${tmpZip}" -C "$EXTRACT_TMP"`,
      `else`,
      `  echo "[sync] bsdtar not found, trying unzip..."`,
      `  unzip -o "${tmpZip}" -d "$EXTRACT_TMP"`,
      `fi`,
      `rm -f "${tmpZip}"`,
      `# GitHub artifacts may nest under data/ — find the actual .db file`,
      `FOUND_DB=$(find "$EXTRACT_TMP" -name "screener.db" -type f | head -1)`,
      `if [ -n "$FOUND_DB" ]; then`,
      `  STAGED_DB="${DATA_DIR}/screener.db.staged.$TS"`,
      `  mv "$FOUND_DB" "$STAGED_DB"`,
      `  echo "[sync] Staged DB: $STAGED_DB"`,
      `else`,
      `  echo "[sync] ERROR: screener.db not found in extracted archive"`,
      `  ls -laR "$EXTRACT_TMP"`,
      `  exit 1`,
      `fi`,
      `rm -rf "$EXTRACT_TMP"`,
      `rm -f "${tmpZip}"`,
      `SIZE=$(du -m "$STAGED_DB" | cut -f1)`,
      `echo "[sync] $(date -u) Extracted staged DB: \${SIZE}MB"`,
      `HEADER=$(head -c 15 "$STAGED_DB")`,
      `if [ "$HEADER" = "SQLite format 3" ]; then`,
      `  echo "[sync] Staged SQLite header OK"`,
      `else`,
      `  echo "[sync] ERROR: Staged SQLite header invalid — file is corrupt"`,
      `  exit 1`,
      `fi`,
      `validate_db () {`,
      `  DB_TO_CHECK="$1" node -e 'const Database=require("better-sqlite3"); const p=process.env.DB_TO_CHECK; const db=new Database(p,{readonly:true}); const ic=db.prepare("PRAGMA integrity_check").all(); const first=ic[0] && ic[0][Object.keys(ic[0])[0]]; if(first!=="ok"){console.error("integrity_check failed:", first); process.exit(1);} const c=db.prepare("SELECT COUNT(*) c FROM companies").get().c; const d=db.prepare("SELECT MAX(date) d FROM daily_bars").get().d; if(!c||!d){console.error("sanity check failed:", c, d); process.exit(1);} console.log("integrity ok; companies=" + c + "; latestDailyBars=" + d); db.close();'`,
      `}`,
      `echo "[sync] Validating staged DB..."`,
      `validate_db "$STAGED_DB"`,
      `echo "[sync] Swapping staged DB into place..."`,
      `mv -f "$STAGED_DB" "${DB_PATH}"`,
      `rm -f "${DB_PATH}-wal"`,
      `rm -f "${DB_PATH}-shm"`,
      `echo "[sync] Validating live DB after swap..."`,
      `if validate_db "${DB_PATH}"; then`,
      `  echo "[sync] Live DB validation passed."`,
      `else`,
      `  echo "[sync] Live DB validation failed after swap."`,
      `  if [ -n "$OLD_DB_BACKUP" ] && [ -f "$OLD_DB_BACKUP" ]; then`,
      `    echo "[sync] Rolling back from backup: $OLD_DB_BACKUP"`,
      `    cp -f "$OLD_DB_BACKUP" "${DB_PATH}"`,
      `    rm -f "${DB_PATH}-wal"`,
      `    rm -f "${DB_PATH}-shm"`,
      `    validate_db "${DB_PATH}" || true`,
      `  fi`,
      `  exit 1`,
      `fi`,
      `PRUNE_LIST=$(ls -1t "$BACKUP_DIR"/screener.db.before-sync.* 2>/dev/null | awk 'NR>3' || true)`,
      `if [ -n "$PRUNE_LIST" ]; then`,
      `  echo "$PRUNE_LIST" | while IFS= read -r old; do rm -f "$old"; done`,
      `fi`,
      `echo "[sync] Backup retention complete (keeping latest 3)."`,
    ].join("\n");

    const scriptPath = join(DATA_DIR, ".sync-download.sh");
    writeFileSync(scriptPath, script, { mode: 0o755 });

    resetDbConnection();
    log("DB connection closed before sync. Starting background download...");
    exec(
      `/bin/sh "${scriptPath}"`,
      {
        timeout: 960_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          SYNC_TOKEN: githubToken,
          SYNC_URL: artifact.archive_download_url,
        },
      },
      (error: Error | null, stdout: string, stderr: string) => {
        if (stdout) {
          for (const line of stdout.split("\n").filter(Boolean)) {
            log(line);
          }
        }
        if (stderr) {
          for (const line of stderr.split("\n").filter(Boolean)) {
            log(`stderr: ${line}`);
          }
        }
        if (error) {
          log(`Background sync FAILED: ${error.message}`);
        } else {
          try {
            const size = Math.round(statSync(DB_PATH).size / 1024 / 1024);
            log(`Background sync complete. DB: ${size}MB`);
          } catch {
            log("Background sync callback: DB file not found after script");
          }
          resetDbConnection();
          log("DB connection reset — next query will open fresh connection");
          try {
            const testDb = new Database(DB_PATH);
            // Detailed integrity check (first 20 issues)
            const ic = testDb
              .prepare("PRAGMA integrity_check(20)")
              .all() as Array<Record<string, string>>;
            const firstResult = ic[0]?.[Object.keys(ic[0])[0]] ?? "unknown";
            if (firstResult === "ok") {
              log("DB integrity_check: ok");
            } else {
              log(`DB integrity_check FAILED (${ic.length} issues):`);
              for (const row of ic.slice(0, 10)) {
                log(`  ${Object.values(row)[0]}`);
              }
            }
            const row = testDb.prepare("SELECT COUNT(*) AS c FROM companies").get() as { c: number };
            const dateRow = testDb.prepare("SELECT MAX(date) AS d FROM daily_bars").get() as { d: string };
            log(`DB verification: ${row.c} companies, latest daily_bars date: ${dateRow.d}`);
            testDb.close();
          } catch (verifyErr: unknown) {
            const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
            log(`DB verification FAILED: ${msg}`);
          }
        }
        try {
          unlinkSync(scriptPath);
        } catch {
          /* best effort */
        }
      }
    );

    return NextResponse.json({
      ok: true,
      message:
        "DB sync started in background with staged validation and rollback protection. Check Render logs for [sync-db] progress.",
      artifact: artifact.name,
      artifactCreated: artifact.created_at,
      artifactSizeMb: sizeMb,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`Sync failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
