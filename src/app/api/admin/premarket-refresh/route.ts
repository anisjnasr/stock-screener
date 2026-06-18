import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { generateAndStoreDailyThemes } from "@/lib/ai/themeExtraction";
import { getSupabaseService } from "@/lib/supabase";
import { ingestMorningNewslettersForDate } from "@/lib/sources/newsletterIngest";

export const runtime = "nodejs";

function parseYmd(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const y = (body as { ymd?: unknown }).ymd;
  if (typeof y !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(y.trim())) return null;
  return y.trim();
}

/**
 * Manual premarket Themes refresh from the UI:
 * 1) ingest newsletter archive
 * 2) regenerate daily themes
 *
 * Not gated by ADMIN_SECRET (same exposure as the rest of the app). Heavy work;
 * protect the deployment network/Vercel/Render as appropriate.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseService();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing ANTHROPIC_API_KEY" }, { status: 503 });
  }

  let ymd = ymdInEt();
  try {
    const raw = await request.json().catch(() => ({}));
    const override = parseYmd(raw);
    if (override) ymd = override;
  } catch {
    // Keep ET default.
  }

  const startedAtMs = Date.now();
  try {
    const newsletterStartedAtMs = Date.now();
    const ingestResult = await ingestMorningNewslettersForDate(supabase, { ymd, signal: request.signal });
    const newsletterElapsedMs = Date.now() - newsletterStartedAtMs;
    // Newsletter ingest is best-effort: if it fails (e.g. Gmail not configured, OAuth error),
    // we still proceed to regenerate themes from whatever is already in newsletter_archive.
    if (!ingestResult.ok) {
      console.warn("[admin/premarket-refresh] newsletter ingest skipped:", ingestResult.error);
    }

    const themesStartedAtMs = Date.now();
    const anthropic = new Anthropic({ apiKey });
    const themesResult = await generateAndStoreDailyThemes(supabase, anthropic, { ymd });
    if (!themesResult.ok) {
      return NextResponse.json({ ok: false, stage: "themes", error: themesResult.error }, { status: 500 });
    }
    const themesElapsedMs = Date.now() - themesStartedAtMs;
    const totalElapsedMs = Date.now() - startedAtMs;

    return NextResponse.json({
      ok: true,
      ymd,
      newsletter: ingestResult.ok
        ? {
            inserted: ingestResult.inserted,
            examined: ingestResult.examined,
            allowlisted: ingestResult.allowlisted,
            elapsedMs: newsletterElapsedMs,
          }
        : { skipped: true, error: ingestResult.error, elapsedMs: newsletterElapsedMs },
      themes: {
        themeCount: themesResult.themeCount,
        elapsedMs: themesElapsedMs,
      },
      elapsedMs: totalElapsedMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[admin/premarket-refresh]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
