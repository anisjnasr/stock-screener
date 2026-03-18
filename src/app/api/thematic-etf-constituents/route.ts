import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { THEMATIC_ETFS } from "@/lib/thematic-etfs";

const DATA_PATH = join(process.cwd(), "data", "thematic-etf-constituents.json");
const VALID_ETFS = new Set(THEMATIC_ETFS.map((x) => x.ticker.toUpperCase()));

type ConstituentsMap = Record<string, string[]>;

function normalizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s ?? "").trim().toUpperCase())
    .filter((s) => /^[A-Z][A-Z0-9.\-]*$/.test(s));
}

export async function GET(request: NextRequest) {
  const etf = String(request.nextUrl.searchParams.get("etf") ?? "").trim().toUpperCase();
  if (!VALID_ETFS.has(etf)) {
    return NextResponse.json(
      { error: "Invalid ETF ticker." },
      { status: 400 }
    );
  }

  if (!existsSync(DATA_PATH)) {
    return NextResponse.json(
      { error: "Thematic constituents file not found. Run: node scripts/build-thematic-etf-constituents.mjs" },
      { status: 404 }
    );
  }

  try {
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as ConstituentsMap;
    return NextResponse.json(normalizeSymbols(parsed?.[etf]));
  } catch {
    return NextResponse.json({ error: "Failed to read constituents" }, { status: 500 });
  }
}
