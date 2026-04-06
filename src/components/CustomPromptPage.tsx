"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CustomPage } from "@/lib/custom-pages-storage";
import { updateCustomPage } from "@/lib/custom-pages-storage";

type ModelChoice = "auto" | "sonnet" | "opus";
type ModelUsed = "sonnet" | "opus";
type SearchSuggestion = { symbol: string; name?: string; exchange?: string };
type SourceTelemetry = {
  enabled?: boolean;
  status?: "not_requested" | "skipped" | "fetched" | "unavailable";
  reason?: string | null;
  missingOrStale?: string[];
  durationMs?: number | null;
};

type Props = {
  page: CustomPage;
  symbol: string;
  companyName?: string | null;
  onSymbolSubmit: (symbol: string) => void;
  onEditPage?: () => void;
  onDeletePage?: () => void;
  compact?: boolean;
  hideSymbolSearch?: boolean;
  hideTemplateActions?: boolean;
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
  const withLinks = input.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = href.trim();
    return `<a href="${safeHref}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });
  return withLinks
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const inner = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    const next = inner[i + 1];
    if (ch === "\\" && (next === "|" || next === "\\")) {
      current += next;
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  if (cells.length < 2) return null;
  return cells;
}

function isTableSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replaceAll(/\s+/g, "")));
}

type TableAlignment = "left" | "right" | "center" | null;

function parseTableAlignments(cells: string[]): TableAlignment[] {
  return cells.map((cell) => {
    const marker = cell.replaceAll(/\s+/g, "");
    if (/^:-{3,}:$/.test(marker)) return "center";
    if (/^:-{3,}$/.test(marker)) return "left";
    if (/^-{3,}:$/.test(marker)) return "right";
    return null;
  });
}

function cellAlignStyle(align: TableAlignment): string {
  if (!align) return "";
  return ` style="text-align: ${align};"`;
}

function renderTable(tableRows: string[][]): string[] {
  if (tableRows.length < 2) return tableRows.map((row) => `<p>${inlineMarkdown(row.join(" | "))}</p>`);
  const headerCells = tableRows[0] ?? [];
  const separatorCells = tableRows[1] ?? [];
  const hasSeparator = isTableSeparatorRow(separatorCells);
  const alignments = hasSeparator ? parseTableAlignments(separatorCells) : [];
  const bodyStart = hasSeparator ? 2 : 1;
  const bodyRows = tableRows.slice(bodyStart);
  if (headerCells.length === 0 || bodyRows.length === 0) {
    return tableRows.map((row) => `<p>${inlineMarkdown(row.join(" | "))}</p>`);
  }
  const head = `<thead><tr>${headerCells
    .map((cell, index) => `<th${cellAlignStyle(alignments[index] ?? null)}>${inlineMarkdown(cell)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${bodyRows
    .map((row) => `<tr>${row
      .map((cell, index) => `<td${cellAlignStyle(alignments[index] ?? null)}>${inlineMarkdown(cell)}</td>`)
      .join("")}</tr>`)
    .join("")}</tbody>`;
  return [`<table>${head}${body}</table>`];
}

function markdownToHtml(markdown: string): string {
  const safe = escapeHtml(markdown || "");
  const lines = safe.split(/\r?\n/);
  const out: string[] = [];
  let inBulletList = false;
  let inOrderedList = false;
  let tableRows: string[][] = [];

  const closeLists = () => {
    if (inBulletList) {
      out.push("</ul>");
      inBulletList = false;
    }
    if (inOrderedList) {
      out.push("</ol>");
      inOrderedList = false;
    }
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    out.push(...renderTable(tableRows));
    tableRows = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeLists();
      flushTable();
      continue;
    }
    const tableRow = parseTableRow(line);
    if (tableRow) {
      closeLists();
      tableRows.push(tableRow);
      continue;
    }
    flushTable();
    if (line.startsWith("### ")) {
      closeLists();
      out.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeLists();
      out.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeLists();
      out.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (inOrderedList) {
        out.push("</ol>");
        inOrderedList = false;
      }
      if (!inBulletList) {
        out.push("<ul>");
        inBulletList = true;
      }
      out.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
      continue;
    }
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (inBulletList) {
        out.push("</ul>");
        inBulletList = false;
      }
      if (!inOrderedList) {
        out.push("<ol>");
        inOrderedList = true;
      }
      out.push(`<li>${inlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }
    closeLists();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeLists();
  flushTable();
  return out.join("\n");
}

function formatLookback(lookback: CustomPage["dataLookback"]): string {
  if (!lookback) return "Default";
  const unit =
    lookback.unit === "weeks"
      ? lookback.value === 1 ? "Week" : "Weeks"
      : lookback.unit === "months"
        ? lookback.value === 1 ? "Month" : "Months"
        : lookback.value === 1 ? "Year" : "Years";
  return `${lookback.value} ${unit}`;
}

export default function CustomPromptPage({
  page,
  symbol,
  companyName,
  onSymbolSubmit,
  onEditPage,
  onDeletePage,
  compact = false,
  hideSymbolSearch = false,
  hideTemplateActions = false,
}: Props) {
  const [querySymbol, setQuerySymbol] = useState(symbol.toUpperCase());
  const [modelChoice, setModelChoice] = useState<ModelChoice>(page.aiModel);
  const [modelUsed, setModelUsed] = useState<ModelUsed | null>(null);
  const [responseText, setResponseText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceTelemetry, setSourceTelemetry] = useState<SourceTelemetry | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const activeRunIdRef = useRef(0);
  const runAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuerySymbol(symbol.toUpperCase());
  }, [symbol]);

  useEffect(() => {
    setModelChoice(page.aiModel);
  }, [page.aiModel, page.id]);

  useEffect(() => {
    return () => {
      runAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (hideSymbolSearch) return;
    const q = querySymbol.trim();
    if (!q || q.length < 1) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionsLoading(false);
      setHighlightedIndex(-1);
      return;
    }
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      setSuggestionsLoading(true);
      fetch(`/api/search-symbol?query=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((rows: SearchSuggestion[]) => {
          if (controller.signal.aborted) return;
          setSuggestions(Array.isArray(rows) ? rows : []);
          setSuggestionsOpen(true);
          setHighlightedIndex(-1);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setSuggestionsOpen(false);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggestionsLoading(false);
        });
    }, 140);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [hideSymbolSearch, querySymbol]);

  const runPrompt = useCallback(async (targetSymbol: string) => {
    if (!targetSymbol.trim()) return;
    runAbortRef.current?.abort();
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;
    const controller = new AbortController();
    runAbortRef.current = controller;
    setLoading(true);
    setError(null);
    setResponseText("");
    setModelUsed(null);
    setSourceTelemetry(null);
    try {
      const res = await fetch("/api/ai-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
          if (runId !== activeRunIdRef.current) return;
          const trimmed = line.trim();
          if (!trimmed) continue;
          const evt = JSON.parse(trimmed) as {
            type: string;
            text?: string;
            modelUsed?: ModelUsed;
            sourceTelemetry?: SourceTelemetry;
            error?: string;
          };
          if (evt.type === "meta" && evt.modelUsed) {
            setModelUsed(evt.modelUsed);
            // If this run used auto/recommended, lock in the chosen model for future runs.
            if (modelChoice === "auto") {
              updateCustomPage(page.id, { aiModel: evt.modelUsed });
              setModelChoice(evt.modelUsed);
            }
          }
          if (evt.type === "meta" && evt.sourceTelemetry) {
            setSourceTelemetry(evt.sourceTelemetry);
          }
          if (evt.type === "delta" && evt.text) setResponseText((prev) => prev + evt.text);
          if (evt.type === "error") throw new Error(evt.error || "AI stream failed");
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to generate response");
    } finally {
      if (runId === activeRunIdRef.current) {
        setLoading(false);
      }
    }
  }, [modelChoice, page.id, page.aiModel, page.dataLookback, page.dataSources, page.prompt]);

  const handleSubmitOrRun = useCallback((nextRaw: string) => {
    const next = nextRaw.trim().toUpperCase();
    if (!next) return;
    setSuggestionsOpen(false);
    if (next !== symbol.toUpperCase()) {
      onSymbolSubmit(next);
      return;
    }
    void runPrompt(next);
  }, [onSymbolSubmit, runPrompt, symbol]);

  useEffect(() => {
    if (!symbol.trim()) return;
    runPrompt(symbol);
  }, [page.id, runPrompt, symbol]);

  const html = useMemo(() => markdownToHtml(responseText), [responseText]);

  return (
    <div
      className={compact ? "h-full min-h-0 overflow-auto px-2 py-2 ai-insight-compact" : "h-full min-h-0 overflow-auto px-4 py-3"}
      style={{ background: "var(--ws-bg2)" }}
    >
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: "var(--ws-text)" }}>
            {symbol.trim() ? `${symbol.toUpperCase()} ${companyName ? `- ${companyName}` : ""}` : "No active stock selected"}
          </div>
          <div className="text-xs" style={{ color: "var(--ws-text-dim)" }}>{page.name}</div>
        </div>
        {!hideSymbolSearch && (
          <form
            className="flex items-center gap-2 ml-auto"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitOrRun(querySymbol);
            }}
          >
            <div className="relative">
              <input
                value={querySymbol}
                onChange={(e) => setQuerySymbol(e.target.value.toUpperCase())}
                onFocus={() => {
                  if (suggestions.length > 0) setSuggestionsOpen(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setSuggestionsOpen(false), 120);
                }}
                onKeyDown={(e) => {
                  if (!suggestionsOpen || suggestions.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
                  } else if (e.key === "Enter" && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
                    e.preventDefault();
                    const picked = suggestions[highlightedIndex].symbol.toUpperCase();
                    setQuerySymbol(picked);
                    handleSubmitOrRun(picked);
                  } else if (e.key === "Escape") {
                    setSuggestionsOpen(false);
                  }
                }}
                className="rounded px-2 py-1 text-sm min-w-[170px]"
                style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
                placeholder="Ticker"
                aria-label="Ticker"
              />
              {suggestionsOpen && (
                <ul
                  className="absolute left-0 top-full z-[120] mt-1 max-h-[50vh] w-[25rem] max-w-[min(90vw,25rem)] overflow-auto rounded py-1 shadow-lg"
                  style={{ background: "var(--ws-bg2)", border: "1px solid var(--ws-border-hover)" }}
                  role="listbox"
                >
                  {suggestionsLoading ? (
                    <li className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>Searching…</li>
                  ) : suggestions.length === 0 ? (
                    <li className="px-3 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>No matches</li>
                  ) : (
                    suggestions.map((s, i) => (
                      <li
                        key={`${s.symbol}-${i}`}
                        role="option"
                        aria-selected={i === highlightedIndex}
                        className="cursor-pointer px-3 py-1.5 text-xs flex items-center gap-3"
                        style={{ background: i === highlightedIndex ? "var(--ws-bg3)" : "transparent" }}
                        onMouseEnter={() => setHighlightedIndex(i)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const picked = s.symbol.toUpperCase();
                          setQuerySymbol(picked);
                          handleSubmitOrRun(picked);
                        }}
                      >
                        <span className="font-medium font-mono shrink-0 min-w-[60px]" style={{ color: "var(--ws-text)" }}>
                          {s.symbol}
                        </span>
                        {s.name && <span style={{ color: "var(--ws-text-dim)" }}>{s.name}</span>}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
              className="rounded px-2 py-1 text-xs"
              style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
              aria-label="Model override"
            >
              <option value="auto">Recommended (Auto)</option>
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
        )}
        {!hideTemplateActions && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded px-2.5 py-1 text-xs font-semibold ws-focus-ring"
              style={{ border: "1px solid var(--ws-border)", color: "var(--ws-text-dim)" }}
              onClick={onEditPage}
            >
              Edit
            </button>
            <button
              type="button"
              className="rounded px-2.5 py-1 text-xs font-semibold ws-focus-ring"
              style={{ border: "1px solid rgba(239,68,68,0.45)", color: "var(--ws-red)" }}
              onClick={onDeletePage}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--ws-bg3)", color: "var(--ws-text)" }}>
          Model: {modelUsed ? (modelUsed === "opus" ? "Opus" : "Sonnet") : modelChoice === "auto" ? "Recommended (auto-selecting...)" : modelChoice}
        </span>
        {!!sourceTelemetry?.enabled && (
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background:
                sourceTelemetry.status === "fetched"
                  ? "rgba(61,220,132,0.16)"
                  : sourceTelemetry.status === "skipped"
                    ? "rgba(0,229,204,0.12)"
                    : sourceTelemetry.status === "unavailable"
                      ? "rgba(239,68,104,0.16)"
                      : "var(--ws-bg3)",
              color:
                sourceTelemetry.status === "fetched"
                  ? "var(--ws-green)"
                  : sourceTelemetry.status === "unavailable"
                    ? "var(--ws-red)"
                    : "var(--ws-text)",
            }}
            title={sourceTelemetry.reason ?? undefined}
          >
            Web: {sourceTelemetry.status ?? "not_requested"}
            {typeof sourceTelemetry.durationMs === "number" ? ` (${sourceTelemetry.durationMs}ms)` : ""}
          </span>
        )}
        <span className="text-xs min-w-0" style={{ color: "var(--ws-text-dim)" }}>
          Sources: {page.dataSources.join(", ")} · Lookback {formatLookback(page.dataLookback)}
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
            {symbol.trim() ? "No response yet. Click Run to generate analysis." : "Select a ticker to start AI analysis."}
          </div>
        )}
        {!!responseText && (
          <article
            className="ai-markdown-output max-w-none text-sm"
            style={{ color: "var(--ws-text)" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
