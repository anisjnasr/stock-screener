import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { THEMATIC_ETFS } from "@/lib/thematic-etfs";
import { resolveDataPath } from "@/lib/data-path";

const DATA_PATH = resolveDataPath("thematic-etf-constituents.json");
const VALID_ETFS = new Set(THEMATIC_ETFS.map((x) => x.ticker.toUpperCase()));

type ConstituentsMap = Record<string, string[]>;

let _parsedCache: { data: ConstituentsMap; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s ?? "").trim().toUpperCase())
    .filter((s) => /^[A-Z][A-Z0-9.\-]*$/.test(s));
}

function loadConstituents(): ConstituentsMap | null {
  if (_parsedCache && Date.now() - _parsedCache.loadedAt < CACHE_TTL_MS) {
    return _parsedCache.data;
  }
  if (!existsSync(DATA_PATH)) return null;
  try {
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as ConstituentsMap;
    _parsedCache = { data: parsed, loadedAt: Date.now() };
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const etf = String(request.nextUrl.searchParams.get("etf") ?? "").trim().toUpperCase();
  if (!VALID_ETFS.has(etf)) {
    return NextResponse.json(
      { error: "Invalid ETF ticker." },
      { status: 400 }
    );
  }

  const data = loadConstituents();
  if (!data) {
    return NextResponse.json(
      { error: "Thematic constituents file not found. Run: node scripts/build-thematic-etf-constituents.mjs" },
      { status: 404 }
    );
  }

  return NextResponse.json(normalizeSymbols(data[etf]), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
