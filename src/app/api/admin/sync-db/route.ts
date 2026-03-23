import { NextRequest, NextResponse } from "next/server";
import {
  existsSync,
  unlinkSync,
  statSync,
  createReadStream,
  createWriteStream,
  renameSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "screener.db");

const STALE_CACHES = [
  "market-monitor-cache.json",
  "sectors-industries-cache.json",
  "breadth-cache.json",
];

/** Stream request body to disk without buffering the whole upload in RAM (512MB Render limit). */
async function streamRequestBodyToFile(
  body: ReadableStream<Uint8Array>,
  destPath: string
): Promise<void> {
  const ws = createWriteStream(destPath);
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        await new Promise<void>((resolve, reject) => {
          ws.write(Buffer.from(value), (err: Error | null | undefined) =>
            err ? reject(err) : resolve()
          );
        });
      }
    }
  } finally {
    reader.releaseLock();
  }
  await new Promise<void>((resolve, reject) => {
    ws.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });
}

function log(msg: string) {
  console.log(`[sync-db] ${msg}`);
}

/**
 * Receives a gzipped screener.db directly from the GitHub Actions workflow.
 * The workflow compresses and uploads the DB in a single curl call — no
 * GitHub artifact API, no GITHUB_TOKEN, no shell tools (curl/wget/unzip)
 * needed on the server side.
 *
 * Workflow sends: curl --data-binary @screener.db.gz ... /api/admin/sync-db
 * This route:     receives body → write to disk → gunzip → swap DB file
 */
export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const auth = request.headers.get("authorization");
  if (!adminSecret || auth !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ts = Date.now();
  const tmpGz = join(DATA_DIR, `sync-${ts}.gz`);
  const tmpDb = join(DATA_DIR, `sync-${ts}.db`);

  const cleanup = () => {
    for (const p of [tmpGz, tmpDb]) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* best effort */
      }
    }
  };

  try {
    mkdirSync(DATA_DIR, { recursive: true });

    log("Receiving gzipped DB upload (streaming to disk)...");
    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "Missing request body" }, { status: 400 });
    }
    await streamRequestBodyToFile(body, tmpGz);
    const gzBytes = statSync(tmpGz).size;
    if (gzBytes < 1024) {
      cleanup();
      return NextResponse.json(
        { error: "Request body too small — expected gzipped screener.db" },
        { status: 400 }
      );
    }
    const gzMb = (gzBytes / 1024 / 1024).toFixed(1);
    log(`Received ${gzMb}MB compressed`);

    log("Decompressing...");
    await pipeline(
      createReadStream(tmpGz),
      createGunzip(),
      createWriteStream(tmpDb)
    );
    unlinkSync(tmpGz);

    if (!existsSync(tmpDb) || statSync(tmpDb).size < 1024) {
      cleanup();
      return NextResponse.json(
        { error: "Decompressed DB is missing or too small" },
        { status: 422 }
      );
    }

    const dbMb = Math.round(statSync(tmpDb).size / 1024 / 1024);
    log(`Decompressed DB: ${dbMb}MB`);

    log("Swapping DB file...");
    renameSync(tmpDb, DB_PATH);

    log("Clearing stale disk caches...");
    for (const name of STALE_CACHES) {
      const p = join(DATA_DIR, name);
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* best effort */
      }
    }

    const finalSize = Math.round(statSync(DB_PATH).size / 1024 / 1024);
    log(`Sync complete. DB: ${finalSize}MB`);

    return NextResponse.json({
      ok: true,
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
