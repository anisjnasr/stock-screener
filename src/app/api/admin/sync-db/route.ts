import { NextRequest, NextResponse } from "next/server";
import {
  createWriteStream,
  existsSync,
  renameSync,
  unlinkSync,
  rmSync,
  mkdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

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

async function streamToFile(body: ReadableStream, dest: string): Promise<void> {
  const writer = createWriteStream(dest);
  const readable = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(readable, writer);
}

function extractZip(zipPath: string, outDir: string): void {
  try {
    execSync(`unzip -o -j "${zipPath}" -d "${outDir}"`, {
      timeout: 300_000,
      stdio: "pipe",
    });
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(outDir, true);
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

  const ts = Date.now();
  const tmpZip = join(DATA_DIR, `sync-${ts}.zip`);
  const tmpDir = join(DATA_DIR, `sync-${ts}`);
  const tmpDb = join(DATA_DIR, `sync-${ts}.db`);

  const cleanup = () => {
    for (const p of [tmpZip, tmpDb]) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch { /* best effort */ }
    }
    try {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  };

  try {
    log("Fetching artifact list from GitHub...");
    const ghHeaders = {
      Authorization: `token ${githubToken}`,
      Accept: "application/vnd.github+json",
    };

    const listRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/artifacts?per_page=20`,
      { headers: ghHeaders }
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

    log("Downloading artifact ZIP...");
    const dlRes = await fetch(artifact.archive_download_url, {
      headers: ghHeaders,
      redirect: "follow",
    });
    if (!dlRes.ok || !dlRes.body) {
      return NextResponse.json(
        { error: `Artifact download failed: ${dlRes.status}` },
        { status: 502 }
      );
    }

    await streamToFile(dlRes.body, tmpZip);
    const zipSize = Math.round(statSync(tmpZip).size / 1024 / 1024);
    log(`Downloaded ${zipSize}MB ZIP to disk`);

    log("Extracting...");
    mkdirSync(tmpDir, { recursive: true });
    extractZip(tmpZip, tmpDir);

    const extractedDb = join(tmpDir, "screener.db");
    if (!existsSync(extractedDb)) {
      cleanup();
      return NextResponse.json(
        { error: "screener.db not found in artifact ZIP" },
        { status: 422 }
      );
    }

    const dbSize = Math.round(statSync(extractedDb).size / 1024 / 1024);
    log(`Extracted DB: ${dbSize}MB`);

    log("Swapping DB file (atomic rename)...");
    renameSync(extractedDb, tmpDb);
    renameSync(tmpDb, DB_PATH);

    log("Clearing stale disk caches...");
    for (const name of STALE_CACHES) {
      const p = join(DATA_DIR, name);
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch { /* best effort */ }
    }

    cleanup();

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
