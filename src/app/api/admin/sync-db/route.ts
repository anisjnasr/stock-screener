import { NextRequest, NextResponse } from "next/server";
import {
  statSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from "fs";
import { join } from "path";
import { exec } from "child_process";
import { resetDbConnection } from "@/lib/screener-db-native";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "screener.db");
const GITHUB_REPO = "anisjnasr/stock-screener";
const SYNC_LOG = join(DATA_DIR, "sync.log");

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
  const line = `[sync-db] ${msg}`;
  console.log(line);
  try { appendFileSync(SYNC_LOG, `${new Date().toISOString()} ${line}\n`); } catch {}
}

async function findLatestArtifact(githubToken: string): Promise<Artifact | null> {
  const listRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/artifacts?per_page=20`,
    {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  if (!listRes.ok) return null;
  const listData = (await listRes.json()) as { artifacts: Artifact[] };
  return listData.artifacts?.find(
    (a) => a.name.startsWith("screener-db-") && !a.expired
  ) ?? null;
}

/**
 * GET: Check sync status — returns last sync log, disk info, DB state.
 */
export async function GET() {
  let syncLog = "";
  try { syncLog = readFileSync(SYNC_LOG, "utf8").split("\n").slice(-50).join("\n"); } catch {}
  let dbSizeMB: number | null = null;
  let dbExists = existsSync(DB_PATH);
  if (dbExists) {
    try { dbSizeMB = Math.round(statSync(DB_PATH).size / 1024 / 1024); } catch {}
  }
  let diskInfo = "";
  try {
    const { execSync } = require("child_process");
    diskInfo = execSync("df -h /app/data 2>/dev/null || df -h . 2>/dev/null || echo 'df unavailable'", { encoding: "utf8" });
  } catch {}
  let tableCheck = "";
  if (dbExists) {
    try {
      const Database = require("better-sqlite3");
      const db = new Database(DB_PATH, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      for (const t of tables) {
        try {
          const r = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number };
          tableCheck += `${t.name}: ${r.c} rows\n`;
        } catch {}
      }
      db.close();
    } catch (e: unknown) {
      tableCheck = `DB open error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return NextResponse.json({
    dbExists,
    dbSizeMB,
    diskInfo: diskInfo.trim(),
    tableCheck: tableCheck.trim(),
    recentLog: syncLog.trim(),
  }, { headers: { "Cache-Control": "no-cache" } });
}

/**
 * POST: Trigger DB sync. Downloads the latest GitHub artifact using streaming
 * extraction (pipe curl directly into bsdtar) so the ZIP is never stored on
 * disk. Peak disk usage = only the extracted DB (~4-5 GB).
 *
 * Requirements on Docker image: curl, libarchive-tools (bsdtar).
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
    const artifact = await findLatestArtifact(githubToken);
    if (!artifact) {
      return NextResponse.json(
        { error: "No unexpired screener-db artifact found" },
        { status: 404 }
      );
    }

    const sizeMb = Math.round(artifact.size_in_bytes / 1024 / 1024);
    log(`Found artifact: ${artifact.name} (${sizeMb}MB compressed, created ${artifact.created_at})`);

    const cacheRm = STALE_CACHES.map(
      (c) => `rm -f "${join(DATA_DIR, c)}"`
    ).join("\n");

    // STREAMING EXTRACTION: pipe curl directly into bsdtar.
    // The ZIP is never written to disk — peak disk = extracted DB only.
    // This is critical because the ZIP (~2 GB) + DB (~5 GB) would exceed
    // the Render disk if both existed simultaneously.
    const extractDir = join(DATA_DIR, ".extract-tmp");
    const script = [
      `set -e`,
      `exec 2>&1`,
      `echo "[sync] ===== SYNC START $(date -u) ====="`,
      `echo "[sync] Tools: curl=$(which curl 2>&1 || echo MISSING) bsdtar=$(which bsdtar 2>&1 || echo MISSING)"`,
      ``,
      `echo "[sync] Disk BEFORE cleanup:"`,
      `df -h "${DATA_DIR}" 2>/dev/null || df -h . 2>/dev/null || true`,
      ``,
      `echo "[sync] Removing old DB and caches..."`,
      `rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"`,
      cacheRm,
      `rm -rf "${extractDir}"`,
      ``,
      `echo "[sync] Disk AFTER cleanup:"`,
      `df -h "${DATA_DIR}" 2>/dev/null || df -h . 2>/dev/null || true`,
      ``,
      `mkdir -p "${extractDir}"`,
      ``,
      `# METHOD 1: Streaming extraction (no ZIP saved to disk)`,
      `echo "[sync] $(date -u) Streaming download -> bsdtar extraction..."`,
      `if curl -fSL --max-time 900 \\`,
      `  -H "Authorization: token $SYNC_TOKEN" \\`,
      `  "$SYNC_URL" | bsdtar xf - -C "${extractDir}"; then`,
      `  echo "[sync] Streaming extraction succeeded"`,
      `else`,
      `  STREAM_EXIT=$?`,
      `  echo "[sync] Streaming extraction failed (exit $STREAM_EXIT), trying download-then-extract..."`,
      `  rm -rf "${extractDir}"`,
      `  mkdir -p "${extractDir}"`,
      `  # METHOD 2: Download ZIP to disk then extract (needs more disk space)`,
      `  TMP_ZIP="${DATA_DIR}/artifact.zip"`,
      `  curl -fSL --max-time 900 \\`,
      `    -H "Authorization: token $SYNC_TOKEN" \\`,
      `    -o "$TMP_ZIP" "$SYNC_URL"`,
      `  echo "[sync] ZIP downloaded: $(du -m "$TMP_ZIP" | cut -f1)MB"`,
      `  bsdtar xf "$TMP_ZIP" -C "${extractDir}"`,
      `  rm -f "$TMP_ZIP"`,
      `fi`,
      ``,
      `echo "[sync] $(date -u) Extraction complete. Finding screener.db..."`,
      `echo "[sync] Extracted contents:"`,
      `find "${extractDir}" -type f -exec ls -lh {} \\;`,
      ``,
      `# Handle possible nesting (upload-artifact may or may not preserve paths)`,
      `FOUND_DB=$(find "${extractDir}" -name "screener.db" -type f | head -1)`,
      `if [ -z "$FOUND_DB" ]; then`,
      `  echo "[sync] ERROR: screener.db not found in extracted archive!"`,
      `  echo "[sync] Full listing:"`,
      `  ls -laR "${extractDir}"`,
      `  exit 1`,
      `fi`,
      ``,
      `DB_SIZE=$(du -m "$FOUND_DB" | cut -f1)`,
      `echo "[sync] Found: $FOUND_DB (\${DB_SIZE}MB)"`,
      ``,
      `# Move to final location (same filesystem = instant rename)`,
      `mv "$FOUND_DB" "${DB_PATH}"`,
      `rm -rf "${extractDir}"`,
      ``,
      `echo "[sync] Disk AFTER extraction:"`,
      `df -h "${DATA_DIR}" 2>/dev/null || df -h . 2>/dev/null || true`,
      ``,
      `# Verify SQLite header`,
      `HEADER=$(head -c 15 "${DB_PATH}")`,
      `if [ "$HEADER" = "SQLite format 3" ]; then`,
      `  echo "[sync] SQLite header: OK"`,
      `else`,
      `  echo "[sync] ERROR: Invalid SQLite header — file corrupt"`,
      `  xxd -l 64 "${DB_PATH}" 2>/dev/null || od -A x -t x1z -N 64 "${DB_PATH}" 2>/dev/null || true`,
      `  exit 1`,
      `fi`,
      ``,
      `FINAL_SIZE=$(du -m "${DB_PATH}" | cut -f1)`,
      `echo "[sync] ===== SYNC COMPLETE $(date -u) ===== DB: \${FINAL_SIZE}MB"`,
    ].join("\n");

    const scriptPath = join(DATA_DIR, ".sync-download.sh");
    writeFileSync(scriptPath, script, { mode: 0o755 });

    resetDbConnection();
    log("DB connection closed before sync. Starting background download...");

    // Truncate log for this sync run
    try { writeFileSync(SYNC_LOG, `=== Sync triggered ${new Date().toISOString()} ===\n`); } catch {}

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
        const output = (stdout || "") + (stderr || "");
        for (const line of output.split("\n").filter(Boolean)) {
          log(line);
        }
        if (error) {
          log(`SYNC FAILED: ${error.message}`);
          return;
        }
        try {
          const size = Math.round(statSync(DB_PATH).size / 1024 / 1024);
          log(`Background sync complete. DB: ${size}MB`);
        } catch {
          log("ERROR: DB file not found after sync script");
          return;
        }
        resetDbConnection();
        log("DB connection reset — next query will open fresh connection");
        try {
          const Database = require("better-sqlite3");
          const testDb = new Database(DB_PATH, { readonly: true });
          const ic = testDb.pragma("quick_check(1)") as Array<Record<string, string>>;
          const firstResult = ic[0]?.[Object.keys(ic[0])[0]] ?? "unknown";
          log(`DB quick_check: ${firstResult}`);
          const tables = ["companies", "daily_bars", "quote_daily", "indicators_daily", "ownership", "financials", "breadth_daily"];
          for (const t of tables) {
            try {
              const r = testDb.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number };
              let dateInfo = "";
              try {
                const d = testDb.prepare(`SELECT MAX(date) AS d FROM "${t}"`).get() as { d: string | null };
                if (d?.d) dateInfo = ` (latest: ${d.d})`;
              } catch {}
              log(`  ${t}: ${r.c.toLocaleString()} rows${dateInfo}`);
            } catch {}
          }
          testDb.close();
          log("DB verification complete — sync successful");
        } catch (verifyErr: unknown) {
          const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
          log(`DB verification FAILED: ${msg}`);
        }
        try { unlinkSync(scriptPath); } catch {}
      }
    );

    return NextResponse.json({
      ok: true,
      message: "DB sync started in background (streaming extraction). Check GET /api/admin/sync-db for progress.",
      artifact: artifact.name,
      artifactCreated: artifact.created_at,
      artifactSizeMb: sizeMb,
      monitorUrl: "/api/admin/sync-db",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`Sync failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
