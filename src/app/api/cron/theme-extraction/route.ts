import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { generateAndStoreDailyThemes } from "@/lib/ai/themeExtraction";
import { getSupabaseService } from "@/lib/supabase";

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
 * Build `daily_themes` from macro + equities writeups, prior themes, and gappers.
 * Secured with CRON_SECRET (Bearer).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return unauthorized();

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing ANTHROPIC_API_KEY" }, { status: 503 });
  }

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
    /* default */
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const result = await generateAndStoreDailyThemes(supabase, anthropic, { ymd });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      ymd,
      themeCount: result.themeCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[theme-extraction]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
