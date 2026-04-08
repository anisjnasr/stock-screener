import { NextRequest, NextResponse } from "next/server";
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { exec, execSync } from "child_process";
import Database from "better-sqlite3";
import { resetDbConnection } from "@/lib/screener-db-native";
import { getDataDir, getScreenerDbPath } from "@/lib/data-path";

const DATA_DIR = getDataDir();
const DB_PATH = getScreenerDbPath();
const SYNC_STATUS_PATH = join(DATA_DIR, "sync-status.json");
const DEFAULT_GITHUB_REPO = "anisjnasr/stock-screener";

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

type ArtifactMode = "daily" | "ownership";
type ManifestArtifactMode = "daily" | "ownership";

type SyncManifest = {
  runId: string;
  mode: ManifestArtifactMode;
  dbBytes: number;
  dbSizeMb: number;
  sha256: string;
  generatedAt: string;
};

type SyncState = "idle" | "running" | "completed" | "failed";

type SyncStatusRecord = {
  state: SyncState;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  mode: ArtifactMode | null;
  artifact: string | null;
  runId: string | null;
  manifestArtifact: string | null;
  repo: string | null;
  wait: boolean | null;
  preflightSnapshot: Record<string, unknown> | null;
  manifest: SyncManifest | null;
  dbSizeMb: number | null;
  error: string | null;
};

function log(msg: string) {
  console.log(`[sync-db] ${msg}`);
}

function getRepoSlug(): string {
  const direct = process.env.GITHUB_REPO?.trim();
  if (direct) return direct;
  const owner = process.env.GITHUB_OWNER?.trim();
  const name = process.env.GITHUB_REPO_NAME?.trim();
  if (owner && name) return `${owner}/${name}`;
  return process.env.GITHUB_REPOSITORY?.trim() || DEFAULT_GITHUB_REPO;
}

function artifactRegex(mode: ArtifactMode): RegExp {
  if (mode === "ownership") return /^screener-db-ownership-\d+$/;
  return /^screener-db-\d+$/;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSyncStatus(): SyncStatusRecord {
  return {
    state: "idle",
    updatedAt: nowIso(),
    startedAt: null,
    completedAt: null,
    mode: null,
    artifact: null,
    runId: null,
    manifestArtifact: null,
    repo: null,
    wait: null,
    preflightSnapshot: null,
    manifest: null,
    dbSizeMb: null,
    error: null,
  };
}

function readSyncStatus(): SyncStatusRecord {
  try {
    const raw = readFileSync(SYNC_STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncStatusRecord>;
    return {
      ...defaultSyncStatus(),
      ...parsed,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return defaultSyncStatus();
  }
}

function writeSyncStatus(next: SyncStatusRecord): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SYNC_STATUS_PATH, JSON.stringify(next, null, 2));
}

function setSyncStatus(patch: Partial<SyncStatusRecord>): SyncStatusRecord {
  const prev = readSyncStatus();
  const next: SyncStatusRecord = {
    ...prev,
    ...patch,
    updatedAt: nowIso(),
  };
  writeSyncStatus(next);
  return next;
}

function manifestArtifactRegex(mode: ArtifactMode): RegExp {
  if (mode === "ownership") return /^screener-db-ownership-manifest-\d+$/;
  return /^screener-db-manifest-\d+$/;
}

function extractRunIdFromArtifactName(name: string, mode: ArtifactMode): string | null {
  const dailyMatch = /^screener-db-(\d+)$/.exec(name);
  if (mode === "daily") return dailyMatch?.[1] ?? null;
  const ownershipMatch = /^screener-db-ownership-(\d+)$/.exec(name);
  return ownershipMatch?.[1] ?? null;
}

function safeFileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function dirBytes(path: string): number {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    const entries = readdirSync(path, { withFileTypes: true });
    for (const e of entries) {
      const p = join(path, e.name);
      if (e.isDirectory()) total += dirBytes(p);
      else if (e.isFile()) total += safeFileBytes(p);
    }
    return total;
  } catch {
    return 0;
  }
}

function freeBytesForPath(path: string): number | null {
  try {
    const out = execSync(`df -Pk "${path}"`, { encoding: "utf8" }).trim();
    const line = out.split("\n")[1];
    if (!line) return null;
    const cols = line.trim().split(/\s+/);
    const availableKb = Number(cols[3]);
    if (!Number.isFinite(availableKb)) return null;
    return availableKb * 1024;
  } catch {
    return null;
  }
}

function bytesToMb(bytes: number): number {
  return Math.ceil(bytes / (1024 * 1024));
}

async function downloadManifest(
  artifact: Artifact,
  expectedRunId: string,
  mode: ArtifactMode,
  githubToken: string
): Promise<SyncManifest> {
  const res = await fetch(artifact.archive_download_url, {
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed downloading manifest artifact: HTTP ${res.status}`);
  }

  const zipPath = join(DATA_DIR, `.manifest-${Date.now()}.zip`);
  const listPath = join(DATA_DIR, `.manifest-list-${Date.now()}.txt`);
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(zipPath, buf);
    const listOut = execSync(`bsdtar -tf "${zipPath}"`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    writeFileSync(listPath, listOut);
    const manifestEntry = listOut
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.endsWith("screener-db-manifest.json"));
    if (!manifestEntry) {
      throw new Error("Manifest artifact missing screener-db-manifest.json");
    }
    const manifestRaw = execSync(`bsdtar -xOf "${zipPath}" "${manifestEntry}"`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const manifest = JSON.parse(manifestRaw) as Partial<SyncManifest>;
    if (!manifest || typeof manifest.dbBytes !== "number" || !manifest.runId) {
      throw new Error("Manifest JSON missing required fields");
    }
    if (manifest.runId !== expectedRunId) {
      throw new Error(
        `Manifest run id mismatch (expected ${expectedRunId}, got ${manifest.runId})`
      );
    }
    if (manifest.mode !== mode) {
      throw new Error(
        `Manifest mode mismatch (expected ${mode}, got ${String(manifest.mode)})`
      );
    }
    return manifest as SyncManifest;
  } finally {
    try {
      unlinkSync(zipPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(listPath);
    } catch {
      // ignore
    }
  }
}

function preflightSnapshot(expectedDbBytes: number, artifactZipBytes: number) {
  const dataFreeBytes = freeBytesForPath(DATA_DIR);
  const tmpFreeBytes = freeBytesForPath("/tmp");
  const liveDbBytes = safeFileBytes(DB_PATH);
  const extractTmpBytes = dirBytes(join(DATA_DIR, ".extract-tmp"));
  let stagedBytes = 0;
  let backupsBytes = 0;
  try {
    for (const name of readdirSync(DATA_DIR)) {
      if (name.startsWith("screener.db.staged.")) {
        stagedBytes += safeFileBytes(join(DATA_DIR, name));
      }
    }
  } catch {
    // ignore
  }
  try {
    const backupsDir = join(DATA_DIR, "backups");
    for (const name of readdirSync(backupsDir)) {
      if (name.startsWith("screener.db.before-sync.")) {
        backupsBytes += safeFileBytes(join(backupsDir, name));
      }
    }
  } catch {
    // ignore
  }

  const marginBytes = 512 * 1024 * 1024;
  const requiredBytes = liveDbBytes + expectedDbBytes + marginBytes;
  const enoughSpace =
    dataFreeBytes != null ? dataFreeBytes >= requiredBytes : false;

  return {
    enoughSpace,
    dataDir: DATA_DIR,
    dbPath: DB_PATH,
    dataFreeBytes,
    dataFreeMb: dataFreeBytes != null ? bytesToMb(dataFreeBytes) : null,
    tmpFreeBytes,
    tmpFreeMb: tmpFreeBytes != null ? bytesToMb(tmpFreeBytes) : null,
    liveDbBytes,
    liveDbMb: bytesToMb(liveDbBytes),
    expectedDbBytes,
    expectedDbMb: bytesToMb(expectedDbBytes),
    artifactZipBytes,
    artifactZipMb: bytesToMb(artifactZipBytes),
    requiredBytes,
    requiredMb: bytesToMb(requiredBytes),
    marginBytes,
    marginMb: bytesToMb(marginBytes),
    existingStagedBytes: stagedBytes,
    existingStagedMb: bytesToMb(stagedBytes),
    existingBackupsBytes: backupsBytes,
    existingBackupsMb: bytesToMb(backupsBytes),
    extractTmpBytes,
    extractTmpMb: bytesToMb(extractTmpBytes),
  };
}

function preflightCleanupDataDir(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }

  const safeRemove = (p: string) => {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  safeRemove(join(DATA_DIR, ".extract-tmp"));
  safeRemove(join(DATA_DIR, "artifact.zip"));

  for (const cacheFile of STALE_CACHES) {
    safeRemove(join(DATA_DIR, cacheFile));
  }

  try {
    const entries = readdirSync(DATA_DIR);
    for (const name of entries) {
      if (name.startsWith("screener.db.staged.")) {
        safeRemove(join(DATA_DIR, name));
      }
    }
  } catch {
    // ignore
  }

  const backupsDir = join(DATA_DIR, "backups");
  try {
    const backupFiles = readdirSync(backupsDir)
      .filter((name) => name.startsWith("screener.db.before-sync."))
      .sort((a, b) => b.localeCompare(a));
    for (const old of backupFiles.slice(1)) {
      safeRemove(join(backupsDir, old));
    }
  } catch {
    // ignore
  }
}

/**
 * Trigger-based DB sync. GH Actions calls this with a small request (no body);
 * the endpoint looks up the latest artifact from the GitHub API, then spawns a
 * background shell process that extracts to a temp dir, validates staged DB,
 * and atomically swaps with rollback protection.
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
  preflightCleanupDataDir();

  try {
    const modeRaw = request.nextUrl.searchParams.get("artifact") ?? "daily";
    const mode: ArtifactMode = modeRaw === "ownership" ? "ownership" : "daily";
    const waitForCompletion = request.nextUrl.searchParams.get("wait") === "true";
    const repoSlug = getRepoSlug();
    log("Fetching artifact list from GitHub...");
    const listRes = await fetch(
      `https://api.github.com/repos/${repoSlug}/actions/artifacts?per_page=50`,
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
    const matcher = artifactRegex(mode);
    const candidates = (listData.artifacts ?? [])
      .filter((a) => !a.expired && matcher.test(a.name))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    const artifact = candidates[0];
    if (!artifact) {
      return NextResponse.json(
        {
          error: `No unexpired artifact found for mode=${mode}`,
          mode,
          repo: repoSlug,
        },
        { status: 404 }
      );
    }

    const sizeMb = Math.round(artifact.size_in_bytes / 1024 / 1024);
    const runId = extractRunIdFromArtifactName(artifact.name, mode);
    if (!runId) {
      return NextResponse.json(
        {
          error: `Could not parse run id from artifact name: ${artifact.name}`,
          mode,
          repo: repoSlug,
        },
        { status: 500 }
      );
    }
    const manifestMatcher = manifestArtifactRegex(mode);
    const manifestArtifact = (listData.artifacts ?? [])
      .filter((a) => !a.expired && manifestMatcher.test(a.name))
      .find((a) => a.name.endsWith(`-${runId}`));
    if (!manifestArtifact) {
      return NextResponse.json(
        {
          error:
            `Missing manifest artifact for run ${runId}. ` +
            "Ensure workflow uploads screener-db-manifest artifact.",
          mode,
          repo: repoSlug,
          artifact: artifact.name,
        },
        { status: 500 }
      );
    }
    const manifest = await downloadManifest(
      manifestArtifact,
      runId,
      mode,
      githubToken
    );
    if (!Number.isFinite(manifest.dbBytes) || manifest.dbBytes <= 0) {
      return NextResponse.json(
        {
          error: "Invalid manifest dbBytes",
          mode,
          repo: repoSlug,
          artifact: artifact.name,
          manifestArtifact: manifestArtifact.name,
        },
        { status: 500 }
      );
    }
    const preflightOnly =
      request.nextUrl.searchParams.get("preflight") === "true";
    const snapshot = preflightSnapshot(manifest.dbBytes, artifact.size_in_bytes);
    if (preflightOnly) {
      return NextResponse.json({
        ok: snapshot.enoughSpace,
        mode,
        wait: waitForCompletion,
        preflight: true,
        repo: repoSlug,
        artifact: artifact.name,
        artifactCreated: artifact.created_at,
        manifestArtifact: manifestArtifact.name,
        manifest,
        snapshot,
      });
    }
    if (!snapshot.enoughSpace) {
      return NextResponse.json(
        {
          ok: false,
          mode,
          wait: waitForCompletion,
          preflight: true,
          status: "insufficient_space",
          repo: repoSlug,
          artifact: artifact.name,
          artifactCreated: artifact.created_at,
          manifestArtifact: manifestArtifact.name,
          manifest,
          snapshot,
          error:
            "Insufficient disk space for safe staged sync. " +
            "No database mutation was performed.",
        },
        { status: 507 }
      );
    }
    log(
      `Found artifact: ${artifact.name} (${sizeMb}MB, created ${artifact.created_at})`
    );
    const runningStatus = setSyncStatus({
      state: "running",
      startedAt: nowIso(),
      completedAt: null,
      mode,
      artifact: artifact.name,
      runId,
      manifestArtifact: manifestArtifact.name,
      repo: repoSlug,
      wait: waitForCompletion,
      preflightSnapshot: snapshot as unknown as Record<string, unknown>,
      manifest,
      dbSizeMb: null,
      error: null,
    });

    const cacheRm = STALE_CACHES.map(
      (c) => `rm -f "${join(DATA_DIR, c)}"`
    ).join("\n");

    // Safe sync flow:
    //   1) Stream artifact ZIP to extract temp (no ZIP file written)
    //   2) Stage screener.db from extracted contents
    //   3) Validate staged DB header + integrity + core table sanity
    //   4) Swap staged DB into place with rollback backup
    //   5) Validate live DB
    const script = [
      `set -eu`,
      `echo "[sync] Tool check:"`,
      `echo "  curl: $(which curl 2>&1 || echo NOT FOUND)"`,
      `echo "  bsdtar: $(which bsdtar 2>&1 || echo NOT FOUND)"`,
      `echo "[sync] $(date -u) Starting sync for ${artifact.name}..."`,
      `if ! command -v bsdtar >/dev/null 2>&1; then`,
      `  echo "[sync] ERROR: bsdtar is required for low-disk artifact extraction"`,
      `  exit 1`,
      `fi`,
      `BACKUP_DIR="${DATA_DIR}/backups"`,
      `mkdir -p "$BACKUP_DIR"`,
      `rm -f "${DATA_DIR}"/screener.db.staged.* "${DATA_DIR}"/screener.db.staged.*-wal "${DATA_DIR}"/screener.db.staged.*-shm || true`,
      `TS=$(date -u +%Y%m%d-%H%M%S)`,
      `STAGED_DB="${DATA_DIR}/screener.db.staged.$TS"`,
      `OLD_DB_BACKUP=""`,
      `rm -f "${DB_PATH}-wal"`,
      `rm -f "${DB_PATH}-shm"`,
      cacheRm,
      `PRUNE_LIST_PRE=$(ls -1t "$BACKUP_DIR"/screener.db.before-sync.* 2>/dev/null | awk 'NR>1' || true)`,
      `if [ -n "$PRUNE_LIST_PRE" ]; then`,
      `  echo "$PRUNE_LIST_PRE" | while IFS= read -r old; do rm -f "$old"; done`,
      `fi`,
      `EXTRACT_TMP="${DATA_DIR}/.extract-tmp"`,
      `rm -rf "$EXTRACT_TMP"`,
      `mkdir -p "$EXTRACT_TMP"`,
      `echo "[sync] Streaming artifact ZIP and extracting archive..."`,
      `curl -fsSL --max-time 1800 -H "Authorization: token $SYNC_TOKEN" "$SYNC_URL" | bsdtar -xf - -C "$EXTRACT_TMP"`,
      `FOUND_DB=$(find "$EXTRACT_TMP" -name "screener.db" -type f | head -1)`,
      `if [ -z "$FOUND_DB" ]; then`,
      `  echo "[sync] ERROR: screener.db not found in extracted archive"`,
      `  ls -laR "$EXTRACT_TMP"`,
      `  exit 1`,
      `fi`,
      `mv "$FOUND_DB" "$STAGED_DB"`,
      `rm -rf "$EXTRACT_TMP"`,
      `if [ ! -s "$STAGED_DB" ]; then`,
      `  echo "[sync] ERROR: staged DB is empty after extraction"`,
      `  exit 1`,
      `fi`,
      `echo "[sync] Staged DB extracted: $STAGED_DB"`,
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
      `if [ -f "${DB_PATH}" ]; then`,
      `  OLD_DB_BACKUP="$BACKUP_DIR/screener.db.before-sync.$TS"`,
      `  mv -f "${DB_PATH}" "$OLD_DB_BACKUP"`,
      `  echo "[sync] Existing DB moved to backup: $OLD_DB_BACKUP"`,
      `fi`,
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
      `    rm -f "${DB_PATH}"`,
      `    mv -f "$OLD_DB_BACKUP" "${DB_PATH}"`,
      `    rm -f "${DB_PATH}-wal"`,
      `    rm -f "${DB_PATH}-shm"`,
      `    validate_db "${DB_PATH}" || true`,
      `  fi`,
      `  exit 1`,
      `fi`,
      `rm -f "${DATA_DIR}"/screener.db.staged.* "${DATA_DIR}"/screener.db.staged.*-wal "${DATA_DIR}"/screener.db.staged.*-shm || true`,
      `PRUNE_LIST=$(ls -1t "$BACKUP_DIR"/screener.db.before-sync.* 2>/dev/null | awk 'NR>1' || true)`,
      `if [ -n "$PRUNE_LIST" ]; then`,
      `  echo "$PRUNE_LIST" | while IFS= read -r old; do rm -f "$old"; done`,
      `fi`,
      `echo "[sync] Backup retention complete (keeping latest 1)."`,
    ].join("\n");

    const scriptPath = join(DATA_DIR, ".sync-download.sh");
    writeFileSync(scriptPath, script, { mode: 0o755 });

    resetDbConnection();
    const execOptions = {
      timeout: 3_600_000,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        SYNC_TOKEN: githubToken,
        SYNC_URL: artifact.archive_download_url,
      },
    };

    if (waitForCompletion) {
      log("DB connection closed before sync. Starting blocking sync...");
      try {
        const { stdout, stderr } = await new Promise<{
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          exec(`/bin/sh "${scriptPath}"`, execOptions, (error, out, err) => {
            if (error) reject(new Error(`${error.message}\n${err || out || ""}`));
            else resolve({ stdout: out, stderr: err });
          });
        });
        if (stdout) {
          for (const line of stdout.split("\n").filter(Boolean)) log(line);
        }
        if (stderr) {
          for (const line of stderr.split("\n").filter(Boolean)) log(`stderr: ${line}`);
        }
        resetDbConnection();
        const size = Math.round(statSync(DB_PATH).size / 1024 / 1024);
        setSyncStatus({
          ...runningStatus,
          state: "completed",
          completedAt: nowIso(),
          dbSizeMb: size,
          error: null,
        });
        return NextResponse.json({
          ok: true,
          mode,
          wait: true,
          repo: repoSlug,
          preflight: snapshot,
          status: "completed",
          artifact: artifact.name,
          artifactCreated: artifact.created_at,
          artifactSizeMb: sizeMb,
          dbSizeMb: size,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Blocking sync FAILED: ${message}`);
        setSyncStatus({
          ...runningStatus,
          state: "failed",
          completedAt: nowIso(),
          error: message,
        });
        return NextResponse.json(
          {
            ok: false,
            mode,
            wait: true,
            repo: repoSlug,
            status: "failed",
            artifact: artifact.name,
            artifactCreated: artifact.created_at,
            error: message,
          },
          { status: 500 }
        );
      } finally {
        try {
          unlinkSync(scriptPath);
        } catch {
          /* best effort */
        }
      }
    }

    log("DB connection closed before sync. Starting background download...");
    exec(`/bin/sh "${scriptPath}"`, execOptions, (error: Error | null, stdout: string, stderr: string) => {
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
        setSyncStatus({
          ...runningStatus,
          state: "failed",
          completedAt: nowIso(),
          error: error.message,
        });
      } else {
        let size: number | null = null;
        try {
          size = Math.round(statSync(DB_PATH).size / 1024 / 1024);
          log(`Background sync complete. DB: ${size}MB`);
        } catch {
          log("Background sync callback: DB file not found after script");
        }
        setSyncStatus({
          ...runningStatus,
          state: "completed",
          completedAt: nowIso(),
          dbSizeMb: size,
          error: null,
        });
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
    });

    return NextResponse.json({
      ok: true,
      mode,
      wait: false,
      repo: repoSlug,
      preflight: snapshot,
      status: "started",
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

export async function GET(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const auth = request.headers.get("authorization");
  if (!adminSecret || auth !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    status: readSyncStatus(),
  });
}
