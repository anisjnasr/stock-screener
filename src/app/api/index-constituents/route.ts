import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const VALID_INDEXES = ["sp500", "nasdaq100", "russell2000"] as const;

const _cache = new Map<string, { data: string[]; loadedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const index = request.nextUrl.searchParams.get("index") ?? "";
  if (!VALID_INDEXES.includes(index as (typeof VALID_INDEXES)[number])) {
    return NextResponse.json(
      { error: "Invalid index. Use: sp500, nasdaq100, russell2000" },
      { status: 400 }
    );
  }

  const cached = _cache.get(index);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  }

  const path = join(process.cwd(), "data", `${index}.json`);
  if (!existsSync(path)) {
    return NextResponse.json(
      { error: `Constituents file not found. Run: node scripts/build-index-constituents.mjs` },
      { status: 404 }
    );
  }
  try {
    const raw = readFileSync(path, "utf8");
    const symbols = JSON.parse(raw) as string[];
    _cache.set(index, { data: symbols, loadedAt: Date.now() });
    return NextResponse.json(symbols, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to read constituents" }, { status: 500 });
  }
}
