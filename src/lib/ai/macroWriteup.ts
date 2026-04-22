import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import { addCalendarDaysYmd } from "@/lib/et-ymd";
import { summarizeThemesForMacroPrompt, fetchDailyThemesForDate } from "@/lib/premarket/dailyThemesRead";
import { etMorningNewsletterWindow } from "@/lib/premarket/et-morning-window";
import type { NewsletterArchiveRow } from "@/types/newsletter-macro";

function buildNewsletterMacroPrompt(params: { bodies: { sender: string; subject: string | null; text: string }[]; yesterdayThemes: string }): string {
  const n = params.bodies.length;
  const blocks = params.bodies
    .map(
      (b, i) =>
        `--- Newsletter ${i + 1} (${b.sender}${b.subject ? ` — ${b.subject}` : ""}) ---\n${b.text.slice(0, 120_000)}`
    )
    .join("\n\n");

  return [
    "You are a senior macro analyst synthesizing overnight research for a professional swing trader.",
    "",
    `Below are ${n} morning newsletters from trusted sources, received between 4 AM and 7 AM ET today.`,
    "Synthesize the most important US macro developments into a 3-5 sentence briefing.",
    "",
    "Newsletters:",
    blocks,
    "",
    "Yesterday's themes (for continuity):",
    params.yesterdayThemes || "(No themes recorded for the prior session.)",
    "",
    "Focus on:",
    "- Fed / monetary policy developments",
    "- Geopolitics affecting markets",
    "- Major data releases or surprises",
    "- Policy / tariff news",
    "- Cross-asset moves (bonds, FX, commodities)",
    "",
    "Tone: terse, buy-side professional. Use prose (not bullets). Show causal flow — \"X happened, which drove Y, affecting Z.\" Avoid generic phrases. Be specific.",
    "",
    "Do NOT quote newsletters directly. Synthesize in your own words.",
    "",
    "Output ONLY the 3-5 sentence paragraph. No preamble, no headers.",
  ].join("\n");
}

async function macroFromWebSearchFallback(anthropic: Anthropic, ymd: string, yesterdayThemes: string): Promise<string> {
  const user = [
    "No trusted morning newsletters were ingested for today (empty mailbox, filters, or Gmail outage).",
    `Today's calendar date (US Eastern) is ${ymd}.`,
    "",
    "Yesterday's themes (for continuity):",
    yesterdayThemes || "(No themes recorded for the prior session.)",
    "",
    "Use the web_search tool to gather **current** overnight information relevant to **US macro markets** (Fed, data, geopolitics, policy, cross-asset drivers).",
    "Then write a **3-5 sentence** macro briefing in the same style as a buy-side morning note: terse, causal, specific.",
    "",
    "Output ONLY the 3-5 sentence paragraph. No preamble, no headers.",
  ].join("\n");

  return streamClaudeText(anthropic, {
    system:
      "You produce factual US macro briefings. Prefer primary sources surfaced by web_search. If the web is inconclusive, say what is uncertain instead of inventing specifics.",
    user,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    toolChoice: { type: "auto" },
    maxTokens: 1600,
  });
}

async function macroFromNewsletters(anthropic: Anthropic, prompt: string): Promise<string> {
  return streamClaudeText(anthropic, {
    system:
      "You synthesize macro research accurately. Never quote sources verbatim; paraphrase. If inputs conflict, briefly reflect the tension.",
    user: prompt,
    maxTokens: 1200,
  });
}

export type MacroWriteupResult =
  | { ok: true; writeupDate: string; fallbackUsed: boolean; sourceCount: number }
  | { ok: false; error: string };

/**
 * Reads `newsletter_archive` for the 4–7 AM ET window on `ymd`, generates a paragraph, upserts `daily_macro_writeup`.
 */
export async function generateAndStoreDailyMacroWriteup(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  opts: { ymd: string }
): Promise<MacroWriteupResult> {
  const { ymd } = opts;
  let window: { startUtcIso: string; endUtcIso: string };
  try {
    window = etMorningNewsletterWindow(ymd);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid ymd" };
  }

  const { data: rows, error: qErr } = await supabase
    .from("newsletter_archive")
    .select("id,sender_email,subject,body_text,received_at")
    .gte("received_at", window.startUtcIso)
    .lt("received_at", window.endUtcIso)
    .order("received_at", { ascending: true });

  if (qErr) {
    return { ok: false, error: qErr.message };
  }

  const archives = (rows ?? []) as Pick<NewsletterArchiveRow, "id" | "sender_email" | "subject" | "body_text" | "received_at">[];

  let writeupText: string;
  let fallbackUsed: boolean;
  const sourceIds: string[] = [];

  const priorYmd = addCalendarDaysYmd(ymd, -1);
  const priorThemes = await fetchDailyThemesForDate(supabase, priorYmd);
  const yesterdayThemes = summarizeThemesForMacroPrompt(priorThemes);

  if (archives.length === 0) {
    fallbackUsed = true;
    try {
      writeupText = await macroFromWebSearchFallback(anthropic, ymd, yesterdayThemes);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Web-search macro failed" };
    }
  } else {
    fallbackUsed = false;
    const bodies = archives.map((r) => ({
      sender: r.sender_email,
      subject: r.subject,
      text: r.body_text,
    }));
    for (const r of archives) sourceIds.push(r.id);
    const prompt = buildNewsletterMacroPrompt({ bodies, yesterdayThemes });
    try {
      writeupText = await macroFromNewsletters(anthropic, prompt);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Newsletter macro failed" };
    }
  }

  const { error: uErr } = await supabase.from("daily_macro_writeup").upsert(
    {
      writeup_date: ymd,
      writeup_text: writeupText,
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

  return { ok: true, writeupDate: ymd, fallbackUsed, sourceCount: archives.length };
}
