import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { adaptSearchResult } from "@/lib/data-adapter";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 1) {
    return NextResponse.json([]);
  }
  if (!FINNHUB_KEY) {
    return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
  }
  try {
    const res = await fetch(
      `${BASE}/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 300 } }
    );
    const data = (await res.json()) as { result?: unknown[] };
    const list = Array.isArray(data.result)
      ? data.result.slice(0, 15).map((item) => adaptSearchResult(item as Record<string, unknown>))
      : [];
    return NextResponse.json(list);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to search" },
      { status: 502 }
    );
  }
}
