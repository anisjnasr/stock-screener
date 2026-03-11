import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const VALID_INDEXES = ["sp500", "nasdaq100", "russell2000"] as const;

export async function GET(request: NextRequest) {
  const index = request.nextUrl.searchParams.get("index") ?? "";
  if (!VALID_INDEXES.includes(index as (typeof VALID_INDEXES)[number])) {
    return NextResponse.json(
      { error: "Invalid index. Use: sp500, nasdaq100, russell2000" },
      { status: 400 }
    );
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
    return NextResponse.json(symbols);
  } catch (e) {
    return NextResponse.json({ error: "Failed to read constituents" }, { status: 500 });
  }
}
