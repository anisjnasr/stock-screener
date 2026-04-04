"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomPage } from "@/lib/custom-pages-storage";

type ModelChoice = "auto" | "sonnet" | "opus";
type ModelUsed = "sonnet" | "opus";

type Props = {
  page: CustomPage;
  symbol: string;
  companyName?: string | null;
  onSymbolSubmit: (symbol: string) => void;
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(input: string): string {
  return input
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown: string): string {
  const safe = escapeHtml(markdown || "");
  const lines = safe.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (line.startsWith("### ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

export default function CustomPromptPage({ page, symbol, companyName, onSymbolSubmit }: Props) {
  const [querySymbol, setQuerySymbol] = useState(symbol.toUpperCase());
  const [modelChoice, setModelChoice] = useState<ModelChoice>("auto");
  const [modelUsed, setModelUsed] = useState<ModelUsed | null>(null);
  const [responseText, setResponseText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuerySymbol(symbol.toUpperCase());
  }, [symbol]);

  const runPrompt = useCallback(async (targetSymbol: string) => {
    if (!targetSymbol.trim()) return;
    setLoading(true);
    setError(null);
    setResponseText("");
    setModelUsed(null);
    try {
      const res = await fetch("/api/ai-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: page.prompt,
          model: modelChoice,
          symbol: targetSymbol.toUpperCase(),
          dataSources: page.dataSources,
          dataLookback: page.dataLookback,
          templateModel: page.aiModel,
        }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || "AI request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const evt = JSON.parse(trimmed) as { type: string; text?: string; modelUsed?: ModelUsed; error?: string };
          if (evt.type === "meta" && evt.modelUsed) setModelUsed(evt.modelUsed);
          if (evt.type === "delta" && evt.text) setResponseText((prev) => prev + evt.text);
          if (evt.type === "error") throw new Error(evt.error || "AI stream failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate response");
    } finally {
      setLoading(false);
    }
  }, [modelChoice, page.aiModel, page.dataLookback, page.dataSources, page.prompt]);

  useEffect(() => {
    runPrompt(symbol);
  }, [page.id, runPrompt, symbol]);

  const html = useMemo(() => markdownToHtml(responseText), [responseText]);

  return (
    <div className="h-full min-h-0 overflow-auto px-4 py-3" style={{ background: "var(--ws-bg2)" }}>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: "var(--ws-text)" }}>
            {symbol.toUpperCase()} {companyName ? `- ${companyName}` : ""}
          </div>
          <div className="text-xs" style={{ color: "var(--ws-text-dim)" }}>{page.name}</div>
        </div>
        <form
          className="flex items-center gap-2 ml-auto"
          onSubmit={(e) => {
            e.preventDefault();
            const next = querySymbol.trim().toUpperCase();
            if (!next) return;
            onSymbolSubmit(next);
            runPrompt(next);
          }}
        >
          <input
            value={querySymbol}
            onChange={(e) => setQuerySymbol(e.target.value.toUpperCase())}
            className="rounded px-2 py-1 text-sm"
            style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
            placeholder="Ticker"
            aria-label="Ticker"
          />
          <select
            value={modelChoice}
            onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
            className="rounded px-2 py-1 text-xs"
            style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
            aria-label="Model override"
          >
            <option value="auto">Auto</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
          <button
            type="submit"
            className="rounded px-2.5 py-1 text-xs font-semibold"
            style={{ background: "var(--ws-cyan)", color: "var(--ws-bg)" }}
          >
            Run
          </button>
        </form>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--ws-bg3)", color: "var(--ws-text)" }}>
          Model: {modelUsed ? (modelUsed === "opus" ? "Opus" : "Sonnet") : modelChoice === "auto" ? "Auto-selecting..." : modelChoice}
        </span>
        <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>
          Sources: {page.dataSources.join(", ")} {page.dataLookback ? `· Lookback ${page.dataLookback}` : ""}
        </span>
      </div>

      <div className="rounded p-3 min-h-[240px]" style={{ background: "var(--ws-bg)", border: "1px solid var(--ws-border)" }}>
        {loading && (
          <div className="text-sm mb-3" style={{ color: "var(--ws-text-dim)" }}>Generating…</div>
        )}
        {error && (
          <div className="text-sm mb-3" style={{ color: "var(--ws-red)" }}>{error}</div>
        )}
        {!loading && !error && !responseText && (
          <div className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
            No response yet. Click Run to generate analysis.
          </div>
        )}
        {!!responseText && (
          <article
            className="prose prose-invert max-w-none text-sm"
            style={{ color: "var(--ws-text)" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
