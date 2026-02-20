import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { stubShortStats } from "@/lib/data-adapter";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }
  const stats = stubShortStats(symbol);
  return NextResponse.json(stats);
}
