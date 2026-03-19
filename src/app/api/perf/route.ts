import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/perf-monitor";

export async function GET() {
  const snapshot = getSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-cache, max-age=0" },
  });
}
