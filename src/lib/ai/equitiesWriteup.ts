import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseModelJson, PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import { fetchCurrentNewsletterArchive } from "@/lib/premarket/currentNewsletterArchive";
import type { NewsletterArchiveRow } from "@/types/newsletter-macro";

function buildEquitiesPrompt(bodies: { sender: string; subject: string | null; text: string }[]): string {
  const n = bodies.length;
  const blocks = bodies
    .map(
      (b, i) =>
        `--- Newsletter ${i + 1} (${b.sender}${b.subject ? ` — ${b.subject}` : ""}) ---\n${b.text.slice(0, 120_000)}`
    )
    .join("\n\n");

  return [
    "You are a senior US equities strategist synthesizing overnight research for a professional swing trader.",
    "",
    `Below are ${n} current newsletters from trusted sources, archived in the last 2 days up to this refresh.`,
    "Extract the most important **US-listed equities** developments as a tight list of bullets.",
    "",
    "Newsletters:",
    blocks,
    "",
    "Rules:",
    "- 5–8 bullets; each bullet one line, max ~180 characters.",
    "- Focus: single-name catalysts, sector rotation, earnings/guidance, M&A, regulatory/legal, notable analyst actions.",
    "- Avoid duplicating pure macro (rates/FX) unless it directly hits equity sectors or names.",
    "",
    "Output **only** valid JSON (no markdown, no prose):",
    '{"bullets":["…","…"]}',
  ].join("\n");
}

async function equitiesFromWebSearchFallback(anthropic: Anthropic, ymd: string): Promise<string[]> {
  const user = [
    "No trusted newsletters were archived in the last 2 days (empty mailbox, filters, or Gmail outage).",
    `Today's calendar date (US Eastern) is ${ymd}.`,
    "",
    "Use the web_search tool to gather **current** overnight information relevant to **US equities** (single names, sectors, earnings, M&A, regulatory).",
    "Then output **only** valid JSON: {\"bullets\":[\"…\",\"…\"]} with 5–8 bullets (each ≤180 chars). No markdown fences.",
  ].join("\n");

  const raw = await streamClaudeText(anthropic, {
    system:
      "You produce factual US equities summaries. Prefer primary sources from web_search. Output strict JSON only.",
    user,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    toolChoice: { type: "auto" },
    maxTokens: 2000,
  });
  const parsed = parseModelJson<{ bullets?: unknown }>(raw);
  const bullets = parsed.bullets;
  if (!Array.isArray(bullets)) throw new Error("Invalid JSON: missing bullets array");
  return bullets.map((b) => String(b).trim()).filter(Boolean);
}

function normalizeBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => String(b).trim()).filter(Boolean).slice(0, 12);
}

export type EquitiesWriteupResult =
  | { ok: true; writeupDate: string; fallbackUsed: boolean; sourceCount: number; bulletCount: number }
  | { ok: false; error: string };

/**
 * Reads the current newsletter archive, generates bullets, upserts `daily_equities_writeup`.
 */
export async function generateAndStoreDailyEquitiesWriteup(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  opts: { ymd: string }
): Promise<EquitiesWriteupResult> {
  const { ymd } = opts;
  const currentArchive = await fetchCurrentNewsletterArchive(supabase);
  if (!currentArchive.ok) return { ok: false, error: currentArchive.error };

  const archives = currentArchive.rows as Pick<NewsletterArchiveRow, "id" | "sender_email" | "subject" | "body_text" | "received_at">[];

  let bullets: string[];
  let fallbackUsed: boolean;
  const sourceIds: string[] = [];

  if (archives.length === 0) {
    fallbackUsed = true;
    try {
      bullets = await equitiesFromWebSearchFallback(anthropic, ymd);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Web-search equities failed" };
    }
  } else {
    fallbackUsed = false;
    const bodies = archives.map((r) => ({
      sender: r.sender_email,
      subject: r.subject,
      text: r.body_text,
    }));
    for (const r of archives) sourceIds.push(r.id);
    const prompt = buildEquitiesPrompt(bodies);
    let raw: string;
    try {
      raw = await streamClaudeText(anthropic, {
        system: "You extract US equities bullets accurately. Output strict JSON only — {\"bullets\":[...]}. No markdown.",
        user: prompt,
        maxTokens: 2000,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Newsletter equities failed" };
    }
    try {
      const parsed = parseModelJson<{ bullets?: unknown }>(raw);
      bullets = normalizeBullets(parsed.bullets);
    } catch {
      return { ok: false, error: "Model returned non-JSON equities output" };
    }
    if (bullets.length < 3) {
      return { ok: false, error: "Too few bullets extracted from newsletters" };
    }
  }

  if (!bullets.length) {
    return { ok: false, error: "No equities bullets produced" };
  }

  const { error: uErr } = await supabase.from("daily_equities_writeup").upsert(
    {
      writeup_date: ymd,
      bullets,
      source_newsletter_ids: sourceIds.length ? sourceIds : null,
      model_used: PREMARKET_CLAUDE_MODEL,
      fallback_used: fallbackUsed,
      generated_at: new Date().toISOString(),
      is_flagged: false,
    },
    { onConflict: "writeup_date" }
  );

  if (uErr) {
    return { ok: false, error: uErr.message };
  }

  return {
    ok: true,
    writeupDate: ymd,
    fallbackUsed,
    sourceCount: archives.length,
    bulletCount: bullets.length,
  };
}
