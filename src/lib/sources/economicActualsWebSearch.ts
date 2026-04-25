import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseModelJson, PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import { addCalendarDaysYmd } from "@/lib/et-ymd";

type EconomicEventPendingActual = {
  id: string;
  event_date: string;
  event_time_et: string | null;
  event_name: string;
  forecast: string | null;
  previous: string | null;
};

type ActualSearchResponse = {
  actual?: string | null;
  confidence?: "high" | "medium" | "low";
  source_url?: string | null;
};

function nowEtParts(): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

function timeToMinutesEt(time: string | null): number | null {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function isDueForActualSearch(event: EconomicEventPendingActual, todayYmd: string, nowMinutesEt: number): boolean {
  const ymd = String(event.event_date).slice(0, 10);
  if (ymd < todayYmd) return true;
  if (ymd > todayYmd) return false;
  const eventMinutes = timeToMinutesEt(event.event_time_et);
  if (eventMinutes == null) return true;
  return nowMinutesEt >= eventMinutes + 1;
}

async function findActualWithWebSearch(
  anthropic: Anthropic,
  event: EconomicEventPendingActual
): Promise<ActualSearchResponse | null> {
  const user = [
    "Find the released ACTUAL value for this US economic calendar event.",
    "Use web_search and prefer official release pages or reputable economic calendar sources.",
    "Return null if the actual has not been released yet or cannot be verified.",
    "",
    `Event date: ${String(event.event_date).slice(0, 10)}`,
    `Event time ET: ${event.event_time_et ?? "unknown"}`,
    `Event name: ${event.event_name}`,
    `Forecast: ${event.forecast ?? "unknown"}`,
    `Previous: ${event.previous ?? "unknown"}`,
    "",
    "Output ONLY valid JSON:",
    '{"actual":"value exactly as a compact display string, e.g. 3.1%, 215K, 50.2, or null","confidence":"high|medium|low","source_url":"https://... or null"}',
  ].join("\n");

  const raw = await streamClaudeText(anthropic, {
    system:
      "You retrieve verified economic data release actuals. Do not guess. If sources conflict or the release is not out, return actual:null.",
    user,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    toolChoice: { type: "auto" },
    maxTokens: 900,
    model: PREMARKET_CLAUDE_MODEL,
  });
  const parsed = parseModelJson<ActualSearchResponse>(raw);
  const actual = parsed.actual != null ? String(parsed.actual).trim() : "";
  if (!actual || actual.toLowerCase() === "null") return null;
  return {
    actual,
    confidence: parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low" ? parsed.confidence : "low",
    source_url: parsed.source_url != null ? String(parsed.source_url).trim() || null : null,
  };
}

export async function runEconomicActualsWebSearch(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  init?: { limit?: number; todayYmd?: string }
): Promise<{ examined: number; updated: number; skipped: number; errors: string[] }> {
  const { ymd: nowYmd, minutes } = nowEtParts();
  const todayYmd = init?.todayYmd ?? nowYmd;
  const fromYmd = addCalendarDaysYmd(todayYmd, -3);
  const limit = Math.max(1, Math.min(12, init?.limit ?? 6));
  const errors: string[] = [];
  let examined = 0;
  let updated = 0;
  let skipped = 0;

  const { data, error } = await supabase
    .from("economic_events")
    .select("id,event_date,event_time_et,event_name,forecast,previous,actual,country,impact")
    .eq("country", "US")
    .gte("event_date", fromYmd)
    .lte("event_date", todayYmd)
    .order("event_date", { ascending: true })
    .order("event_time_et", { ascending: true });

  if (error) return { examined: 0, updated: 0, skipped: 0, errors: [error.message] };

  const pending = ((data ?? []) as Array<EconomicEventPendingActual & { actual?: string | null }>)
    .filter((event) => event.actual == null || String(event.actual).trim() === "")
    .filter((event) => isDueForActualSearch(event, todayYmd, minutes))
    .slice(0, limit);

  for (const event of pending) {
    examined += 1;
    try {
      const result = await findActualWithWebSearch(anthropic, event);
      if (!result?.actual) {
        skipped += 1;
        continue;
      }
      const { error: updateError } = await supabase
        .from("economic_events")
        .update({ actual: result.actual, updated_at: new Date().toISOString() })
        .eq("id", event.id);
      if (updateError) {
        errors.push(`${event.event_name} ${event.event_date}: ${updateError.message}`);
      } else {
        updated += 1;
      }
    } catch (e) {
      errors.push(`${event.event_name} ${event.event_date}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { examined, updated, skipped, errors };
}
