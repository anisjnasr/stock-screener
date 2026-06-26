/**
 * Phase-2 dilution pipeline (spec §6).
 * The AI ONLY parses filing text into structured instruments. All math (potential
 * shares, overhang %) is done here in code so the numbers stay live + debuggable.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DDFilingText } from "./edgar";
import {
  DD_FLAG_SEVERITY,
  type DDExtractedInstrument,
  type DDExtractionResult,
  type DDFlag,
  type DDInstrument,
  type DDOverhangBreakdown,
  type DDOverhangSegment,
} from "./types";

const EXTRACTION_MODEL = process.env.DD_EXTRACTION_MODEL?.trim() || "claude-sonnet-4-6";
/** Total filing text budget fed to the model (chars; newest filings first). */
const TOTAL_TEXT_BUDGET = 180_000;

const SYSTEM_PROMPT =
  "You extract dilution instruments from SEC filings for a small-cap trader. Use only the provided " +
  "filing text — never invent figures. Every instrument must cite the filing it came from. Distinguish " +
  "authorized capacity from actual issuance. Mark each instrument active vs closed/expired; if status is " +
  "unconfirmable, mark it unconfirmed and state the assumption. Output ONLY valid JSON matching the schema. No prose.";

const SCHEMA_HINT = `Return ONLY this JSON shape:
{
  "instruments": [
    {
      "type": "ATM | ELOC | secondary | warrants | convertible | preferred | shelf",
      "label": "string",
      "authorized_usd": number | null,
      "used_usd": number | null,
      "remaining_usd": number | null,
      "share_count": number | null,
      "exercise_or_conversion_price": number | null,
      "is_variable_conversion": boolean,
      "floor_price": number | null,
      "expiry": "YYYY-MM-DD" | null,
      "is_prefunded": boolean,
      "key_terms": "string" | null,
      "status": "active | closed | expired | unconfirmed",
      "flags": ["string"],
      "source": "FORM YYYY-MM-DD"
    }
  ],
  "reverse_split_confirmations": [
    { "effective_date": "YYYY-MM-DD" | null, "ratio": "1-for-25" | null, "shares_before": number | null, "shares_after": number | null, "source": "string" | null }
  ],
  "notes": ["string"]
}`;

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^[\s\S]*?```(?:json)?/i, (m) => (m.includes("```") ? "" : m))
    .replace(/```[\s\S]*$/, "")
    .trim();
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function coerceInstrument(raw: unknown): DDExtractedInstrument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type ?? "").trim();
  const valid = ["ATM", "ELOC", "secondary", "warrants", "convertible", "preferred", "shelf"];
  if (!valid.includes(type)) return null;
  return {
    type: type as DDExtractedInstrument["type"],
    label: String(o.label ?? type),
    authorized_usd: num(o.authorized_usd),
    used_usd: num(o.used_usd),
    remaining_usd: num(o.remaining_usd),
    share_count: num(o.share_count),
    exercise_or_conversion_price: num(o.exercise_or_conversion_price),
    is_variable_conversion: o.is_variable_conversion === true,
    floor_price: num(o.floor_price),
    expiry: typeof o.expiry === "string" ? o.expiry : null,
    is_prefunded: o.is_prefunded === true,
    key_terms: typeof o.key_terms === "string" ? o.key_terms : null,
    status: ["active", "closed", "expired", "unconfirmed"].includes(String(o.status))
      ? (o.status as DDExtractedInstrument["status"])
      : "unconfirmed",
    flags: Array.isArray(o.flags) ? o.flags.map((f) => String(f)) : [],
    source: String(o.source ?? ""),
  };
}

/** Parse the model output defensively (spec §6.3). Throws on unrecoverable failure. */
export function parseExtraction(text: string): DDExtractionResult {
  const cleaned = stripJsonFences(text);
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const instruments = Array.isArray(parsed.instruments)
    ? parsed.instruments.map(coerceInstrument).filter((i): i is DDExtractedInstrument => i !== null)
    : [];
  const splits = Array.isArray(parsed.reverse_split_confirmations)
    ? (parsed.reverse_split_confirmations as Record<string, unknown>[]).map((s) => ({
        effective_date: typeof s.effective_date === "string" ? s.effective_date : null,
        ratio: typeof s.ratio === "string" ? s.ratio : null,
        shares_before: num(s.shares_before),
        shares_after: num(s.shares_after),
        source: typeof s.source === "string" ? s.source : null,
      }))
    : [];
  const notes = Array.isArray(parsed.notes) ? parsed.notes.map((n) => String(n)) : [];
  return { instruments, reverse_split_confirmations: splits, notes };
}

function buildFilingsBlob(filings: DDFilingText[]): string {
  const parts: string[] = [];
  let used = 0;
  for (const f of filings) {
    if (used >= TOTAL_TEXT_BUDGET) break;
    const remaining = TOTAL_TEXT_BUDGET - used;
    const chunk = `\n\n===== FILING: ${f.source} =====\n${f.text.slice(0, remaining)}`;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("");
}

/** Call the extraction model. Returns the raw extraction result (no math yet). */
export async function extractDilution(filings: DDFilingText[], signal?: AbortSignal): Promise<DDExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  if (filings.length === 0) return { instruments: [], reverse_split_confirmations: [], notes: [] };

  const anthropic = new Anthropic({ apiKey });
  const blob = buildFilingsBlob(filings);
  const msg = await anthropic.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 4000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${SCHEMA_HINT}\n\nFILINGS:\n${blob}` }],
    },
    signal ? { signal } : undefined
  );
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseExtraction(text);
}

// --- in-code overhang math (spec §6.4) ---

const FLAG_PRIORITY: DDFlag[] = [
  "toxic",
  "in-default",
  "active",
  "pre-funded",
  "ITM",
  "available",
  "near-expiry",
  "shelf-only",
  "registered",
  "fixed",
  "OTM",
  "exhausted",
  "expired",
];

const VALID_FLAGS = new Set<DDFlag>(FLAG_PRIORITY);

function derivePrimaryFlag(flags: string[]): DDFlag | null {
  const present = new Set(flags.filter((f): f is DDFlag => VALID_FLAGS.has(f as DDFlag)));
  for (const f of FLAG_PRIORITY) {
    if (present.has(f)) return f;
  }
  return null;
}

/** Compute potential shares + flags for one instrument given the live price. */
function computeInstrument(inst: DDExtractedInstrument, price: number | null): DDInstrument {
  const flags = new Set<string>(inst.flags);
  let potential: number | null = null;
  let openEnded = false;

  const addCmp = (strike: number | null) => {
    if (price != null && strike != null && strike > 0) {
      flags.add(strike < price ? "ITM" : "OTM");
    }
  };

  switch (inst.type) {
    case "ATM":
    case "ELOC":
    case "secondary": {
      const remaining = inst.remaining_usd ?? inst.authorized_usd;
      if (remaining != null && price != null && price > 0) potential = remaining / price;
      if (inst.status === "active") flags.add("active");
      break;
    }
    case "shelf": {
      flags.add("shelf-only");
      const remaining = inst.remaining_usd ?? inst.authorized_usd;
      if (remaining != null && price != null && price > 0) potential = remaining / price;
      break;
    }
    case "warrants": {
      potential = inst.share_count;
      if (inst.is_prefunded) flags.add("pre-funded");
      addCmp(inst.exercise_or_conversion_price);
      break;
    }
    case "convertible":
    case "preferred": {
      const principal = inst.remaining_usd ?? inst.authorized_usd;
      if (inst.is_variable_conversion) {
        flags.add("toxic");
        openEnded = true;
        if (principal != null && inst.floor_price != null && inst.floor_price > 0) {
          potential = principal / inst.floor_price; // floor estimate
        }
      } else if (principal != null && inst.exercise_or_conversion_price != null && inst.exercise_or_conversion_price > 0) {
        potential = principal / inst.exercise_or_conversion_price;
        flags.add("fixed");
        addCmp(inst.exercise_or_conversion_price);
      }
      break;
    }
  }

  if (inst.status === "expired") flags.add("expired");

  const primary = derivePrimaryFlag([...flags]);
  return {
    ...inst,
    flags: [...flags],
    potential_shares: potential != null && Number.isFinite(potential) ? Math.round(potential) : null,
    open_ended: openEnded,
    primary_flag: primary,
    severity: primary ? DD_FLAG_SEVERITY[primary] : null,
  };
}

export type ComputedDilution = {
  instruments: DDInstrument[];
  overhang: DDOverhangBreakdown;
};

/** §6.4 — compute per-instrument shares + aggregate overhang against current shares. */
export function computeOverhang(
  extracted: DDExtractedInstrument[],
  currentSharesOutstanding: number | null,
  price: number | null
): ComputedDilution {
  // Expired instruments drop out of the overhang.
  const instruments = extracted
    .filter((i) => i.status !== "expired")
    .map((i) => computeInstrument(i, price));

  const segments: DDOverhangSegment[] = [];
  let potentialNew = 0;
  let anyOpenEnded = false;

  for (const inst of instruments) {
    if (inst.open_ended) anyOpenEnded = true;
    if (inst.potential_shares != null && inst.potential_shares > 0) {
      potentialNew += inst.potential_shares;
      segments.push({ label: inst.label, shares: inst.potential_shares, open_ended: inst.open_ended });
    } else if (inst.open_ended) {
      segments.push({ label: inst.label, shares: 0, open_ended: true });
    }
  }

  const fullyDiluted =
    currentSharesOutstanding != null ? currentSharesOutstanding + potentialNew : null;
  const overhangPct =
    currentSharesOutstanding != null && currentSharesOutstanding > 0
      ? Math.round((potentialNew / currentSharesOutstanding) * 1000) / 10
      : null;

  return {
    instruments,
    overhang: {
      current_shares_outstanding: currentSharesOutstanding,
      potential_new_shares: potentialNew,
      fully_diluted_shares: fullyDiluted,
      overhang_pct: overhangPct,
      open_ended: anyOpenEnded,
      segments,
    },
  };
}
