import { createReadStream, statSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getScreenerDbPath } from "@/lib/data-path";
import { ensureLargeCapSlimExportDb } from "@/lib/screener-slim-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorizeExport(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  const admin = process.env.ADMIN_SECRET?.trim();
  const pyKey = process.env.PYTHON_SERVICE_KEY?.trim();
  return Boolean((admin && token === admin) || (pyKey && token === pyKey));
}

/**
 * Stream screener.db for the Python service (or operators).
 * ?variant=large_cap — slim DB (~300–800 MB) for 512 MB Python instances; default is full export.
 * Auth: ADMIN_SECRET or PYTHON_SERVICE_KEY.
 */
export async function GET(request: NextRequest) {
  if (!authorizeExport(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const variant = request.nextUrl.searchParams.get("variant")?.trim().toLowerCase() ?? "full";

  let dbPath: string;
  try {
    dbPath = variant === "large_cap" ? ensureLargeCapSlimExportDb() : getScreenerDbPath();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  try {
    const stat = statSync(dbPath);
    if (!stat.isFile() || stat.size <= 0) {
      return NextResponse.json({ error: "Export database missing or empty" }, { status: 503 });
    }
    const stream = createReadStream(dbPath);
    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
        "X-Screener-Export-Variant": variant,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
