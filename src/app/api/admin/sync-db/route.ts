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
  console.log(`[sync-db] ${msg}`);
}

/**
 * Trigger-based DB sync. GH Actions calls this with a small request (no body);
 * the endpoint looks up the latest artifact from the GitHub API, then spawns a
 * background shell process: curl downloads the ZIP to disk, then unzip -p
 * extracts screener.db. Requires ~7 GB peak disk (ZIP + extracted DB).
 *
 * Requirements on the Docker image: curl, unzip.
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

    // Two-step: download ZIP to disk, then extract with `unzip -p` (handles
    // ZIP64 which funzip cannot). Disk budget on 10 GB:
    //   1. Delete old DB + caches → ~0 GB used
    //   2. Download ZIP → ~2.2 GB
    //   3. Extract: unzip -p reads ZIP, pipes to screener.db → peak ~7.2 GB
    //   4. Delete ZIP → ~5 GB final
    const script = [
      `set -e`,
      `echo "[sync] $(date -u) Downloading ${artifact.name}..." > "${SYNC_LOG}"`,
      `rm -f "${DB_PATH}"`,
      `rm -f "${tmpZip}"`,
      cacheRm,
      `echo "[sync] Old DB removed. Downloading ZIP..." >> "${SYNC_LOG}"`,
      `curl -fSL --max-time 900 \\`,
      `  -H "Authorization: token $SYNC_TOKEN" \\`,
      `  -o "${tmpZip}" "$SYNC_URL" 2>> "${SYNC_LOG}"`,
      `ZIP_SIZE=$(du -m "${tmpZip}" | cut -f1)`,
      `echo "[sync] $(date -u) ZIP downloaded: \${ZIP_SIZE}MB. Extracting..." >> "${SYNC_LOG}"`,
      `unzip -p "${tmpZip}" > "${DB_PATH}"`,
      `rm -f "${tmpZip}"`,
      `SIZE=$(du -m "${DB_PATH}" | cut -f1)`,
      `echo "[sync] $(date -u) Complete. DB: \${SIZE}MB" >> "${SYNC_LOG}"`,
    ].join("\n");

    const scriptPath = join(DATA_DIR, ".sync-download.sh");
    writeFileSync(scriptPath, script, { mode: 0o755 });

    resetDbConnection();
    log("DB connection closed before sync. Starting background download...");
    exec(
      `/bin/sh "${scriptPath}"`,
      {
        timeout: 960_000,
        env: {
          ...process.env,
          SYNC_TOKEN: githubToken,
          SYNC_URL: artifact.archive_download_url,
        },
      },
      (error: Error | null, _stdout: string, stderr: string) => {
        if (error) {
          log(
            `Background sync FAILED: ${error.message}${stderr ? ` | ${stderr.slice(0, 500)}` : ""}`
          );
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
            const testDb = new Database(DB_PATH, { readonly: true });
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
