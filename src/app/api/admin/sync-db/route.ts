import { NextRequest, NextResponse } from "next/server";
import { existsSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "screener.db");
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
 * Downloads a GitHub artifact and extracts screener.db to `dest`.
 *
 * Strategy 1 (preferred): curl | funzip  — streams the ZIP through funzip
 *   directly to the output file. Peak memory: ~256KB (curl buffer + funzip).
 *   Peak disk: only the output file (no ZIP stored).
 *
 * Strategy 2 (fallback): curl → disk ZIP → unzip -p → output file.
 *   Used when funzip is not available. Needs temporary disk space for the ZIP.
 */
function downloadAndExtract(
  url: string,
  token: string,
  dest: string
): void {
  const authHeader = `Authorization: token ${token}`;
  const curlBase = `curl -fSL --max-time 900 -H "${authHeader}"`;

  try {
    execSync(
      `${curlBase} "${url}" | funzip > "${dest}"`,
      { timeout: 960_000, stdio: "pipe", shell: "/bin/bash" }
    );
    return;
  } catch {
    log("funzip not available, falling back to download-then-extract");
  }

  const tmpZip = `${dest}.zip`;
  try {
    execSync(
      `${curlBase} -o "${tmpZip}" "${url}"`,
      { timeout: 960_000, stdio: "pipe" }
    );
    execSync(
      `unzip -p "${tmpZip}" screener.db > "${dest}"`,
      { timeout: 300_000, stdio: "pipe", shell: "/bin/bash" }
    );
  } finally {
    try { if (existsSync(tmpZip)) unlinkSync(tmpZip); } catch { /* best effort */ }
  }
}

export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const githubToken = process.env.GITHUB_TOKEN;

  const auth = request.headers.get("authorization");
  if (!adminSecret || auth !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!githubToken) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN not configured on server" },
      { status: 500 }
    );
  }

  const tmpDb = join(DATA_DIR, `sync-${Date.now()}.db`);

  const cleanup = () => {
    for (const p of [tmpDb, `${tmpDb}.zip`]) {
      try { if (existsSync(p)) unlinkSync(p); } catch { /* best effort */ }
    }
  };

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

    log(
      `Found artifact: ${artifact.name} (${Math.round(artifact.size_in_bytes / 1024 / 1024)}MB, created ${artifact.created_at})`
    );

    log("Downloading and extracting via curl (memory-safe)...");
    downloadAndExtract(artifact.archive_download_url, githubToken, tmpDb);

    if (!existsSync(tmpDb) || statSync(tmpDb).size < 1024) {
      cleanup();
      return NextResponse.json(
        { error: "Extracted DB is missing or too small" },
        { status: 422 }
      );
    }

    const dbSize = Math.round(statSync(tmpDb).size / 1024 / 1024);
    log(`Extracted DB: ${dbSize}MB`);

    log("Swapping DB file...");
    execSync(`mv "${tmpDb}" "${DB_PATH}"`, { stdio: "pipe" });

    log("Clearing stale disk caches...");
    for (const name of STALE_CACHES) {
      const p = join(DATA_DIR, name);
      try { if (existsSync(p)) unlinkSync(p); } catch { /* best effort */ }
    }

    const finalSize = Math.round(statSync(DB_PATH).size / 1024 / 1024);
    log(`Sync complete. DB: ${finalSize}MB, artifact: ${artifact.name}`);

    return NextResponse.json({
      ok: true,
      artifact: artifact.name,
      artifactCreated: artifact.created_at,
      dbSizeMb: finalSize,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    cleanup();
    const message = e instanceof Error ? e.message : String(e);
    log(`Sync failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
