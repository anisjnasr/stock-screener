import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  getCompanyClassification,
  getCompanyName,
  getDailyBars,
  getFinancialsNative,
  getLatestScreenerDate,
  getOwnershipNative,
  getScreenerSnapshot,
} from "@/lib/screener-db-native";

export const runtime = "nodejs";

type ModelChoice = "auto" | "sonnet" | "opus";
type ModelUsed = "sonnet" | "opus";

type ReqBody = {
  prompt?: string;
  model?: ModelChoice;
  symbol?: string;
  dataSources?: Array<"database" | "web">;
  dataLookback?: "1y" | "5y" | "";
};

function normalizeSymbol(input: unknown): string {
  const s = String(input ?? "").toUpperCase().trim();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : "";
}

function parseBody(raw: unknown): ReqBody {
  if (!raw || typeof raw !== "object") return {};
  return raw as ReqBody;
}

function chooseBarsLimit(lookback: "1y" | "5y" | ""): number {
  if (lookback === "1y") return 252;
  if (lookback === "5y") return 1260;
  return 300;
}

function jsonLine(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

async function classifyModel(anthropic: Anthropic, prompt: string): Promise<ModelUsed> {
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8,
    temperature: 0,
    system:
      "Classify whether this prompt requires complex multi-step reasoning, nuanced judgment, or synthesis across many data points. Respond with only 'opus' or 'sonnet'.",
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content
    .map((c) => ("text" in c ? c.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  return text.includes("opus") ? "opus" : "sonnet";
}

function buildDatabaseContext(symbol: string, lookback: "1y" | "5y" | ""): Record<string, unknown> {
  const asOfDate = getLatestScreenerDate() ?? "";
  const snapshot = getScreenerSnapshot({ symbols: [symbol], limit: 1 }).rows[0] ?? null;
  const company = {
    name: getCompanyName(symbol),
    classification: getCompanyClassification(symbol),
  };
  const financials = {
    annual: getFinancialsNative(symbol, "annual", 8),
    quarterly: getFinancialsNative(symbol, "quarterly", 8),
  };
  const ownership = getOwnershipNative(symbol, 8);
  const bars = asOfDate ? getDailyBars(symbol, asOfDate, chooseBarsLimit(lookback)) : [];
  return { asOfDate, company, snapshot, financials, ownership, bars };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const body = parseBody(await req.json().catch(() => ({})));
  const symbol = normalizeSymbol(body.symbol);
  const prompt = String(body.prompt ?? "").trim();
  if (!symbol || !prompt) {
    return NextResponse.json({ error: "symbol and prompt are required" }, { status: 400 });
  }
  const dataSources = Array.isArray(body.dataSources) ? body.dataSources : ["database"];
  const dataLookback = body.dataLookback === "1y" || body.dataLookback === "5y" ? body.dataLookback : "";
  const requestedModel: ModelChoice = body.model === "opus" || body.model === "sonnet" || body.model === "auto"
    ? body.model
    : "auto";

  const anthropic = new Anthropic({ apiKey });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        try {
          let modelUsed: ModelUsed;
          if (requestedModel === "auto") {
            modelUsed = await classifyModel(anthropic, prompt);
          } else {
            modelUsed = requestedModel;
          }

          const modelName = modelUsed === "opus" ? "claude-opus-4-20250514" : "claude-sonnet-4-20250514";
          controller.enqueue(jsonLine({ type: "meta", modelUsed }));

          const context: Record<string, unknown> = { symbol, dataSources, dataLookback };
          if (dataSources.includes("database")) {
            context.database = buildDatabaseContext(symbol, dataLookback);
          }
          if (dataSources.includes("web")) {
            context.web = { note: "Web source is enabled but currently limited to user-provided prompt context." };
          }

          const system = [
            "You are an equity research assistant.",
            "Use provided context first. If context is missing, say so explicitly instead of fabricating values.",
            "Be concise, structured, and include key risks/assumptions.",
          ].join(" ");

          const user = [
            `Symbol: ${symbol}`,
            `Data sources: ${dataSources.join(", ")}`,
            dataLookback ? `Data lookback: ${dataLookback}` : "",
            "",
            "Context JSON:",
            JSON.stringify(context, null, 2),
            "",
            "User prompt:",
            prompt,
          ].filter(Boolean).join("\n");

          const msgStream = anthropic.messages.stream({
            model: modelName,
            max_tokens: 2200,
            temperature: 0.2,
            system,
            messages: [{ role: "user", content: user }],
          });

          for await (const event of msgStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(jsonLine({ type: "delta", text: event.delta.text }));
            }
          }
          controller.enqueue(jsonLine({ type: "done" }));
          controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI completion failed";
          controller.enqueue(jsonLine({ type: "error", error: message }));
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
