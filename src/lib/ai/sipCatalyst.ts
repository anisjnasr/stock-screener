import Anthropic from "@anthropic-ai/sdk";
import { parseModelJson, PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { SipCatalyst, SipCatalystCategory, SipConfidence, SipGuidanceTone } from "@/types/sip-catalyst";

const CATEGORIES: SipCatalystCategory[] = [
  "earnings",
  "guidance",
  "m_and_a",
  "partnership",
  "product",
  "regulatory",
  "analyst",
  "macro_sector",
  "other",
  "unclear",
];

const CHUNK = 8;
const MAX_HEADLINES = 8;
const MAX_TITLE_LEN = 220;

function normalizeCategory(raw: unknown): SipCatalystCategory {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "_and_")
    .replace(/[\s-]+/g, "_");
  const map: Record<string, SipCatalystCategory> = {
    earnings: "earnings",
    guidance: "guidance",
    m_and_a: "m_and_a",
    ma: "m_and_a",
    merger: "m_and_a",
    acquisition: "m_and_a",
    partnership: "partnership",
    product: "product",
    regulatory: "regulatory",
    fda: "regulatory",
    analyst: "analyst",
    macro_sector: "macro_sector",
    macro: "macro_sector",
    sector: "macro_sector",
    other: "other",
    unclear: "unclear",
    unknown: "unclear",
  };
  return map[s] ?? "unclear";
}

function normalizeGuidanceTone(raw: unknown): SipGuidanceTone | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "positive" || s === "negative" || s === "neutral" || s === "mixed") return s;
  return null;
}

function normalizeConfidence(raw: unknown): SipConfidence {
  const s = String(raw ?? "medium").trim().toLowerCase();
  if (s === "high" || s === "low") return s;
  return "medium";
}

export type SipCatalystParsed = { ticker: string; catalyst: SipCatalyst };

/** Exported for tests: coerce one raw model row. */
export function parseSipCatalystRow(raw: Record<string, unknown>): SipCatalystParsed | null {
  const ticker = String(raw.ticker ?? "").trim().toUpperCase();
  if (!ticker) return null;
  const category = normalizeCategory(raw.category);
  const summary = String(raw.summary ?? "").trim();
  if (!summary) return null;
  const guidanceRaw = raw.guidance_tone ?? raw.guidanceTone;
  let guidance_tone = normalizeGuidanceTone(guidanceRaw);
  if (guidance_tone && category !== "earnings" && category !== "guidance") {
    guidance_tone = null;
  }
  return {
    ticker,
    catalyst: {
      category,
      summary: summary.slice(0, 1200),
      guidance_tone,
      confidence: normalizeConfidence(raw.confidence),
    },
  };
}

function buildTickerBlock(
  r: GapperRow,
  headlines: PythonNewsItem[] | undefined
): string {
  const lines: string[] = [];
  lines.push(`### ${r.ticker}`);
  lines.push(`gap_pct: ${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(2)}%`);
  lines.push(`earnings_last_24h: ${r.earningsRecent24h}`);
  lines.push(`company: ${r.companyName ?? "—"}`);
  lines.push(`sector: ${r.sector ?? "—"} | industry: ${r.industry ?? "—"}`);
  const hs = (headlines ?? []).slice(0, MAX_HEADLINES);
  if (hs.length === 0) {
    lines.push("Headlines: (none — infer only from gap/sector/earnings flag; use category unclear if insufficient).");
  } else {
    lines.push("Headlines:");
    for (const h of hs) {
      const t = (h.title ?? "").trim().slice(0, MAX_TITLE_LEN);
      if (t) lines.push(`- ${t}`);
    }
  }
  return lines.join("\n");
}

async function runChunk(anthropic: Anthropic, blocks: string): Promise<SipCatalystParsed[]> {
  const user = [
    "For each ticker below, infer the PRIMARY premarket catalyst using ONLY the provided headline lines and flags.",
    "Do not invent specific numbers, beats, or deals not clearly suggested by the headlines or earnings_last_24h.",
    "If headlines are empty or irrelevant, set category to unclear and explain the limited visibility in the summary.",
    "",
    "summary: 2-4 sentences, terse buy-side style.",
    "guidance_tone: only for category earnings or guidance — one of positive | negative | neutral | mixed; else null.",
    "confidence: high | medium | low based on how direct the headline evidence is.",
    "",
    "You MUST include one JSON object per ticker shown below, with the exact ticker symbol in each row.",
    "",
    "Output ONLY valid JSON (no markdown):",
    '{"catalysts":[{"ticker":"AAPL","category":"earnings","summary":"...","guidance_tone":null,"confidence":"medium"}]}',
    "",
    "Allowed category values exactly:",
    CATEGORIES.join(" | "),
    "",
    blocks,
  ].join("\n");

  const raw = await streamClaudeText(anthropic, {
    system:
      "You classify US equity premarket catalysts. Output strict JSON only. Never fabricate earnings results not in the text.",
    user,
    maxTokens: 4096,
    model: PREMARKET_CLAUDE_MODEL,
  });

  const parsed = parseModelJson<{ catalysts?: unknown }>(raw);
  const arr = parsed.catalysts;
  if (!Array.isArray(arr)) return [];

  const out: SipCatalystParsed[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = parseSipCatalystRow(item as Record<string, unknown>);
    if (row) out.push(row);
  }
  return out;
}

function fallbackUnclear(message: string): SipCatalyst {
  return {
    category: "unclear",
    summary: message,
    guidance_tone: null,
    confidence: "low",
  };
}

/**
 * Produces ticker → catalyst for SIP rows. Batches to control prompt size.
 * `news` may be null (model uses gap/sector/earnings flag only).
 */
export async function generateSipCatalystMap(
  anthropic: Anthropic,
  rows: GapperRow[],
  news: Record<string, PythonNewsItem[]> | null
): Promise<Record<string, SipCatalyst>> {
  const map: Record<string, SipCatalyst> = {};
  if (rows.length === 0) return map;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const blocks = slice.map((r) => buildTickerBlock(r, news?.[r.ticker])).join("\n\n");
    let pairs: SipCatalystParsed[] = [];
    try {
      pairs = await runChunk(anthropic, blocks);
    } catch {
      for (const r of slice) {
        map[r.ticker] = fallbackUnclear("Catalyst model failed for this batch; try refresh.");
      }
      continue;
    }
    const seen = new Set<string>();
    for (const { ticker, catalyst } of pairs) {
      map[ticker] = catalyst;
      seen.add(ticker);
    }
    for (const r of slice) {
      if (!seen.has(r.ticker)) {
        map[r.ticker] = fallbackUnclear(
          "No catalyst row returned for this symbol; headlines may be insufficient."
        );
      }
    }
  }

  return map;
}
