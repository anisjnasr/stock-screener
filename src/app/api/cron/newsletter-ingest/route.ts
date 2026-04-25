import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { getSupabaseService } from "@/lib/supabase";
import { ingestMorningNewslettersForDate } from "@/lib/sources/newsletterIngest";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseYmd(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const y = (body as { ymd?: unknown }).ymd;
  if (typeof y !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(y.trim())) return null;
  return y.trim();
}

/**
 * Gmail → `newsletter_archive` for allowlisted messages from the last 2 days.
 * Secured with CRON_SECRET (Bearer), same pattern as other crons.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return unauthorized();

  const supabase = getSupabaseService();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 }
    );
  }

  let ymd = ymdInEt();
  try {
    const raw = await request.json().catch(() => ({}));
    const override = parseYmd(raw);
    if (override) ymd = override;
  } catch {
    /* use default */
  }

  try {
    const result = await ingestMorningNewslettersForDate(supabase, { ymd, signal: request.signal });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      ymd,
      inserted: result.inserted,
      examined: result.examined,
      allowlisted: result.allowlisted,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[newsletter-ingest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
