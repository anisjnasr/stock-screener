import { NextRequest, NextResponse } from "next/server";
import {
  existsSync,
  statSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { exec } from "child_process";

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
 * background `curl | funzip` to download + extract the DB directly on the
 * persistent disk. Returns immediately so HTTP timeouts are not an issue.
 *
 * Requirements on the Docker image: curl, unzip (provides funzip).
 * Requirements on Render env: ADMIN_SECRET, GITHUB_TOKEN (PAT with actions:read).
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

    const tmpDb = join(DATA_DIR, "screener.db.new");
    const cacheRm = STALE_CACHES.map(
      (c) => `rm -f "${join(DATA_DIR, c)}"`
    ).join("\n");

    // Write a sync script that runs entirely via shell tools (curl + funzip).
    // This keeps Node.js memory at zero for the download/extract.
    // The script writes to a .new file first, then atomically renames over
    // the old DB so the app is never left without a DB file.
    const script = [
      `set -e`,
      `echo "[sync] $(date -u) Downloading ${artifact.name}..." > "${SYNC_LOG}"`,
      cacheRm,
      `curl -fSL --max-time 900 \\`,
      `  -H "Authorization: token $SYNC_TOKEN" \\`,
      `  "$SYNC_URL" 2>> "${SYNC_LOG}" | funzip > "${tmpDb}"`,
      `mv -f "${tmpDb}" "${DB_PATH}"`,
      `SIZE=$(du -m "${DB_PATH}" | cut -f1)`,
      `echo "[sync] $(date -u) Complete. DB: \${SIZE}MB" >> "${SYNC_LOG}"`,
    ].join("\n");

    const scriptPath = join(DATA_DIR, ".sync-download.sh");
    writeFileSync(scriptPath, script, { mode: 0o755 });

    log("Starting background download...");
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
          try {
            unlinkSync(tmpDb);
          } catch {
            /* best effort */
          }
        } else {
          try {
            const size = Math.round(statSync(DB_PATH).size / 1024 / 1024);
            log(`Background sync complete. DB: ${size}MB`);
          } catch {
            log("Background sync callback: DB file not found after script");
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
        "DB sync started in background. The download runs via curl+funzip on the server. Check Render logs for progress.",
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
