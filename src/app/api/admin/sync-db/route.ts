import { NextRequest, NextResponse } from "next/server";
import { existsSync, unlinkSync, statSync, createWriteStream, renameSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

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
 * Downloads a GitHub artifact ZIP and extracts screener.db to `dest`.
 *
 * Uses Node.js native fetch (streaming to disk) + unzip command.
 * No curl/funzip/bash dependency — works on Alpine minimal images.
 */
async function downloadAndExtract(
  url: string,
  token: string,
  dest: string
): Promise<void> {
  const tmpZip = `${dest}.zip`;
  try {
    log("Downloading artifact via Node.js fetch (streaming to disk)...");
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}` },
      redirect: "follow",
    });
    if (!res.ok || !res.body) {
      throw new Error(`Artifact download failed: HTTP ${res.status}`);
    }

    await pipeline(
      Readable.fromWeb(res.body as import("stream/web").ReadableStream),
      createWriteStream(tmpZip)
    );

    const zipMb = Math.round(statSync(tmpZip).size / 1024 / 1024);
    log(`Downloaded ZIP: ${zipMb}MB`);

    execSync(`unzip -o -p "${tmpZip}" screener.db > "${dest}"`, {
      timeout: 300_000,
      stdio: "pipe",
    });
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

    log("Downloading and extracting artifact...");
    await downloadAndExtract(artifact.archive_download_url, githubToken, tmpDb);

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
    renameSync(tmpDb, DB_PATH);

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
