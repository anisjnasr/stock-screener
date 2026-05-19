import { NextRequest, NextResponse } from "next/server";
import { triggerPythonScreenerDbSync } from "@/lib/trigger-python-db-sync";

export const dynamic = "force-dynamic";

/**
 * POST — trigger Python service to pull the current screener.db from this app.
 * Auth: ADMIN_SECRET. Used after daily refresh (GitHub Actions) or manual ops.
 */
export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const auth = request.headers.get("authorization");
  if (!adminSecret || auth !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wait = request.nextUrl.searchParams.get("wait") === "true";
  const result = await triggerPythonScreenerDbSync({ wait, reason: "admin-trigger" });
  if (result.skipped) {
    return NextResponse.json({ ok: false, skipped: true, error: result.error }, { status: 503 });
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, status: result.status }, { status: 503 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
