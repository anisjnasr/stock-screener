import Anthropic from "@anthropic-ai/sdk";
import { parseModelJson, PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type {
  SipCatalyst,
  SipCatalystCategory,
  SipConfidence,
  SipGuidanceTone,
  SipQualifyingChecks,
} from "@/types/sip-catalyst";

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

const CHUNK = 12;
const MAX_HEADLINES = 8;
const MAX_TITLE_LEN = 220;
const MAX_URLS = 12;

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

function normalizeChecks(raw: unknown): SipQualifyingChecks {
  if (!raw || typeof raw !== "object") {
    return {
      company_specific_news: false,
      surprises_market: false,
    };
  }
  const o = raw as Record<string, unknown>;
  const company =
    o.company_specific_news !== undefined
      ? Boolean(o.company_specific_news)
      : Boolean(o.changes_story);
  return {
    company_specific_news: company,
    surprises_market: Boolean(o.surprises_market),
  };
}

function allChecksTrue(c: SipQualifyingChecks): boolean {
  return c.company_specific_news && c.surprises_market;
}

export type SipCatalystParsed = { ticker: string; catalyst: SipCatalyst };

/** Exported for tests: coerce one raw model row (strict SIP gate). */
export function parseSipCatalystRow(raw: Record<string, unknown>): SipCatalystParsed | null {
  const ticker = String(raw.ticker ?? "").trim().toUpperCase();
  if (!ticker) return null;

  const checksRaw = raw.checks ?? raw.volume_moving_checks;
  const checks = normalizeChecks(checksRaw);
  let qualifies = Boolean(raw.qualifies_as_sip);
  if (!allChecksTrue(checks)) qualifies = false;

  const rationale = String(raw.catalyst_rationale ?? raw.summary ?? "").trim();
  if (!rationale) return null;
  if (!qualifies) return null;

  const category = normalizeCategory(raw.catalyst_category ?? raw.category);
  const guidanceRaw = raw.guidance_tone ?? raw.guidanceTone;
  let guidance_tone = normalizeGuidanceTone(guidanceRaw);
  if (guidance_tone && category !== "earnings" && category !== "guidance") {
    guidance_tone = null;
  }

  let ranking_score = Number(raw.ranking_score);
  if (!Number.isFinite(ranking_score)) ranking_score = 5;
  ranking_score = Math.min(10, Math.max(1, Math.round(ranking_score)));

  const urlsRaw = raw.catalyst_source_urls ?? raw.sources;
  const catalyst_source_urls = Array.isArray(urlsRaw)
    ? urlsRaw.map((u) => String(u).trim()).filter(Boolean).slice(0, MAX_URLS)
    : [];

  return {
    ticker,
    catalyst: {
      category,
      summary: rationale.slice(0, 1200),
      guidance_tone,
      confidence: normalizeConfidence(raw.confidence),
      qualifies_as_sip: true,
      checks,
      ranking_score,
      catalyst_source_urls,
      macro_aligned: Boolean(raw.macro_aligned),
      macro_theme_tag: raw.macro_theme_tag != null ? String(raw.macro_theme_tag).trim() || null : null,
      industry_aligned: Boolean(raw.industry_aligned),
      industry_theme_tag: raw.industry_theme_tag != null ? String(raw.industry_theme_tag).trim() || null : null,
    },
  };
}

function advFracLabel(r: GapperRow): string {
  const adv = r.avgVolume90d;
  if (adv == null || !Number.isFinite(adv) || adv <= 0) return "adv_missing";
  const pct = (r.pmVolume / adv) * 100;
  return `${pct.toFixed(1)}%_of_90d_ADV`;
}

function headlineAgeHint(publishedAt: number | null | undefined): string {
  if (publishedAt == null || !Number.isFinite(publishedAt)) return "";
  const ms = publishedAt > 1e12 ? publishedAt : publishedAt * 1000;
  const hours = (Date.now() - ms) / 3_600_000;
  if (!Number.isFinite(hours)) return "";
  return ` (~${hours.toFixed(1)}h ago)`;
}

function buildTickerBlock(r: GapperRow, headlines: PythonNewsItem[] | undefined): string {
  const lines: string[] = [];
  lines.push(`### ${r.ticker}`);
  lines.push(`gap_pct: ${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(2)}%`);
  lines.push(`premarket_volume_shares: ${Math.round(r.pmVolume)}`);
  lines.push(`avg_volume_90d: ${r.avgVolume90d != null ? Math.round(r.avgVolume90d) : "null"}`);
  lines.push(`pm_vol_vs_adv: ${advFracLabel(r)}`);
  lines.push(`earnings_last_24h: ${r.earningsRecent24h}`);
  lines.push(`company: ${r.companyName ?? "—"}`);
  lines.push(`sector: ${r.sector ?? "—"} | industry: ${r.industry ?? "—"}`);
  const hs = (headlines ?? []).slice(0, MAX_HEADLINES);
  if (hs.length === 0) {
    lines.push(
      "Headlines: (none — cannot set company_specific_news without at least one headline; omit this ticker unless you infer a same-day company-specific story is impossible)."
    );
  } else {
    lines.push("Headlines (use timestamps for 24h freshness when present):");
    for (const h of hs) {
      const t = (h.title ?? "").trim().slice(0, MAX_TITLE_LEN);
      if (t) lines.push(`- ${t}${headlineAgeHint(h.published_at ?? null)}`);
    }
  }
  return lines.join("\n");
}

const SIP_SYSTEM_PROMPT = `You are tagging pre-market "Stocks in Play" for US equities.

Each candidate already passed HARD FILTERS: |gap| ≥ 2%, pre-market volume ≥ 100,000 shares, and PM volume ≥ 20% of 90-day average volume. Do not re-check those.

For each ticker, apply exactly TWO checks. The stock qualifies ONLY if BOTH are TRUE.

CHECK 1 — company_specific_news: There is news that is primarily about THIS company (the issuer). It can be any substantive item (earnings, filing, deal, product, executive, legal, etc.) — it does NOT need to be "material" or market-moving.
Set FALSE when the only mentions are: broad market newsletters or "stocks to watch" lists that lump many tickers together without a story centered on this name; generic sector/macro pieces that only name the ticker in passing; or no usable headline text.

CHECK 2 — surprises_market (freshness): At least one qualifying headline is from the LAST 24 HOURS. Use the "~Xh ago" hints when present. If timestamps are missing, infer cautiously from wording (e.g. "today", "overnight"); if you cannot tell, set FALSE.

Do NOT use any other gates (no "forces a decision", no "staying power").

Use ranking_score 1–10 only for sorting among qualifiers (higher = clearer / richer story). Add +1 if macro_aligned, +1 if industry_aligned; cap at 10.

Do not invent facts not supported by the headlines. If there are no headlines, omit the ticker (cannot pass check 1).

Output ONLY valid JSON with key "classifications" (array). Each element:
ticker, checks { company_specific_news, surprises_market }, qualifies_as_sip (true only if both checks true), catalyst_category, catalyst_rationale (2–4 short sentences), catalyst_source_urls (from news links if available, else []), guidance_tone (only for earnings/guidance: positive|negative|neutral|mixed, else null), confidence (high|medium|low), macro_aligned, macro_theme_tag, industry_aligned, industry_theme_tag, ranking_score.

Return ONLY rows where qualifies_as_sip is true.`;

async function runChunk(anthropic: Anthropic, blocks: string, themesSummary: string): Promise<SipCatalystParsed[]> {
  const policyTape = "(none — policy tape not wired in this build)";
  const user = [
    SIP_SYSTEM_PROMPT,
    "",
    "=== TODAY'S MACRO / INDUSTRY THEMES ===",
    themesSummary.trim() || "(none loaded)",
    "",
    "=== POLICY TAPE (Truth Social / classified) ===",
    policyTape,
    "",
    "=== CANDIDATES ===",
    blocks,
    "",
    'Output ONLY valid JSON (no markdown): {"classifications":[{"ticker":"NVDA","checks":{"company_specific_news":true,"surprises_market":true},"qualifies_as_sip":true,"catalyst_category":"earnings","catalyst_rationale":"...","catalyst_source_urls":[],"guidance_tone":null,"confidence":"high","macro_aligned":false,"macro_theme_tag":null,"industry_aligned":true,"industry_theme_tag":"AI capex","ranking_score":8}]}',
    "",
    "Allowed catalyst_category values exactly:",
    CATEGORIES.join(" | "),
  ].join("\n");

  const raw = await streamClaudeText(anthropic, {
    system: "You tag SIP candidates using two headline checks. Output strict JSON only. Never fabricate facts not in the input.",
    user,
    maxTokens: 3000,
    model: PREMARKET_CLAUDE_MODEL,
  });

  const parsed = parseModelJson<{ classifications?: unknown }>(raw);
  const arr = parsed.classifications;
  if (!Array.isArray(arr)) return [];

  const out: SipCatalystParsed[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = parseSipCatalystRow(item as Record<string, unknown>);
    if (row) out.push(row);
  }
  return out;
}

export type GenerateSipCatalystResult = {
  catalystByTicker: Record<string, SipCatalyst>;
  /** Qualified tickers sorted by ranking_score desc, then ticker. */
  qualifiedOrder: string[];
};

/**
 * Classifies SIP candidates. Only rows that pass strict JSON gates appear in `qualifiedOrder`.
 */
export async function generateSipCatalystMap(
  anthropic: Anthropic,
  rows: GapperRow[],
  news: Record<string, PythonNewsItem[]> | null,
  themesSummary: string
): Promise<GenerateSipCatalystResult> {
  const catalystByTicker: Record<string, SipCatalyst> = {};
  const qualifiedOrder: string[] = [];

  if (rows.length === 0) {
    return { catalystByTicker, qualifiedOrder };
  }

  const allowed = new Set(rows.map((r) => r.ticker.toUpperCase()));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const blocks = slice.map((r) => buildTickerBlock(r, news?.[r.ticker])).join("\n\n");
    try {
      const pairs = await runChunk(anthropic, blocks, themesSummary);
      for (const { ticker, catalyst } of pairs) {
        if (!allowed.has(ticker)) continue;
        catalystByTicker[ticker] = catalyst;
      }
    } catch {
      /* chunk failed — skip tickers in this batch */
    }
  }

  const ranked = Object.entries(catalystByTicker)
    .filter(([, c]) => c.qualifies_as_sip)
    .sort((a, b) => {
      const d = b[1].ranking_score - a[1].ranking_score;
      if (d !== 0) return d;
      return a[0].localeCompare(b[0]);
    });
  for (const [t] of ranked) {
    qualifiedOrder.push(t);
  }

  return { catalystByTicker, qualifiedOrder };
}
