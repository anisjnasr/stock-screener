import { NextRequest, NextResponse } from "next/server";
import {
  statSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { exec } from "child_process";
import { resetDbConnection } from "@/lib/screener-db-native";
import { getDataDir, getScreenerDbPath } from "@/lib/data-path";

const DATA_DIR = getDataDir();
const DB_PATH = getScreenerDbPath();
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

    // Two-step: download ZIP to disk, then extract with bsdtar (from
    // libarchive-tools) which handles ZIP64 reliably — Alpine's unzip
    // silently corrupts files >4 GB. Disk budget on 10 GB:
    //   1. Delete old DB + caches → ~0 GB used
    //   2. Download ZIP → ~2.2 GB
    //   3. Extract directly to disk → peak ~7.2 GB (ZIP + extracted DB)
    //   4. Delete ZIP → ~5 GB final
    const script = [
      `set -e`,
      `echo "[sync] Tool check:"`,
      `echo "  curl: $(which curl 2>&1 || echo NOT FOUND)"`,
      `echo "  bsdtar: $(which bsdtar 2>&1 || echo NOT FOUND)"`,
      `echo "  unzip: $(which unzip 2>&1 || echo NOT FOUND)"`,
      `echo "[sync] $(date -u) Downloading ${artifact.name}..."`,
      `rm -f "${DB_PATH}"`,
      `rm -f "${tmpZip}"`,
      cacheRm,
      `echo "[sync] Old DB removed. Downloading ZIP..."`,
      `curl -fSL --max-time 900 \\`,
      `  -H "Authorization: token $SYNC_TOKEN" \\`,
      `  -o "${tmpZip}" "$SYNC_URL"`,
      `ZIP_SIZE=$(du -m "${tmpZip}" | cut -f1)`,
      `echo "[sync] $(date -u) ZIP downloaded: \${ZIP_SIZE}MB"`,
      // Use bsdtar if available (handles ZIP64), fallback to unzip
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
      `  mv "$FOUND_DB" "${DB_PATH}"`,
      `  echo "[sync] Moved $FOUND_DB -> ${DB_PATH}"`,
      `else`,
      `  echo "[sync] ERROR: screener.db not found in extracted archive"`,
      `  ls -laR "$EXTRACT_TMP"`,
      `  exit 1`,
      `fi`,
      `rm -rf "$EXTRACT_TMP"`,
      `SIZE=$(du -m "${DB_PATH}" | cut -f1)`,
      `echo "[sync] $(date -u) Extracted. DB: \${SIZE}MB"`,
      `HEADER=$(head -c 15 "${DB_PATH}")`,
      `if [ "$HEADER" = "SQLite format 3" ]; then`,
      `  echo "[sync] SQLite header OK"`,
      `else`,
      `  echo "[sync] ERROR: SQLite header invalid — file is corrupt"`,
      `  exit 1`,
      `fi`,
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
            const Database = require("better-sqlite3");
            const testDb = new Database(DB_PATH);
            // Detailed integrity check (first 20 issues)
            const ic = testDb.pragma("integrity_check(20)") as Array<Record<string, string>>;
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
        "DB sync started in background. Downloads ZIP then extracts via unzip. Check Render logs for [sync-db] progress.",
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
