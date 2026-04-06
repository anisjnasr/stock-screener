"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import type { CustomPage, LookbackUnit } from "@/lib/custom-pages-storage";
import { DEFAULT_INSIGHT_PROMPT_TEMPLATE } from "@/lib/custom-pages-storage";

type InsightInput = Omit<CustomPage, "id" | "createdAt">;

type Props = {
  mode: "create" | "edit";
  initialPage?: CustomPage | null;
  onSubmit: (input: InsightInput) => void;
  onCancelEdit?: () => void;
};

export default function AIInsightFormPage({ mode, initialPage, onSubmit, onCancelEdit }: Props) {
  const [name, setName] = useState("");
  const [aiModel, setAiModel] = useState<"auto" | "sonnet" | "opus">("auto");
  const [useDatabase, setUseDatabase] = useState(true);
  const [useWeb, setUseWeb] = useState(false);
  const [lookbackValue, setLookbackValue] = useState("1");
  const [lookbackUnit, setLookbackUnit] = useState<LookbackUnit>("years");
  const [prompt, setPrompt] = useState(DEFAULT_INSIGHT_PROMPT_TEMPLATE);

  const title = useMemo(() => (mode === "edit" ? "Edit Insight" : "New Insight"), [mode]);

  useEffect(() => {
    if (mode === "edit" && initialPage) {
      setName(initialPage.name);
      setAiModel(initialPage.aiModel);
      setUseDatabase(initialPage.dataSources.includes("database"));
      setUseWeb(initialPage.dataSources.includes("web"));
      setLookbackValue(initialPage.dataLookback ? String(initialPage.dataLookback.value) : "1");
      setLookbackUnit(initialPage.dataLookback?.unit ?? "years");
      setPrompt(initialPage.prompt);
      return;
    }
    setName("");
    setAiModel("auto");
    setUseDatabase(true);
    setUseWeb(false);
    setLookbackValue("1");
    setLookbackUnit("years");
    setPrompt(DEFAULT_INSIGHT_PROMPT_TEMPLATE);
  }, [initialPage, mode]);

  return (
    <div className="h-full min-h-0 overflow-hidden px-4 py-3" style={{ background: "var(--ws-bg2)" }}>
      <div className="h-full min-h-0 max-w-4xl mx-auto rounded p-4 flex flex-col" style={{ background: "var(--ws-bg)", border: "1px solid var(--ws-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--ws-text)" }}>
            {title}
          </h2>
          {mode === "edit" && onCancelEdit && (
            <button
              type="button"
              className="text-xs px-2 py-1 rounded ws-focus-ring"
              style={{ color: "var(--ws-text-dim)", border: "1px solid var(--ws-border)" }}
              onClick={onCancelEdit}
            >
              Cancel Edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <label className="text-xs" style={{ color: "var(--ws-text-dim)" }}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded px-2 py-1 text-sm"
              style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
              placeholder="AI Thesis"
            />
          </label>
          <label className="text-xs" style={{ color: "var(--ws-text-dim)" }}>
            AI model default
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value as "auto" | "sonnet" | "opus")}
              className="mt-1 w-full rounded px-2 py-1 text-sm"
              style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
            >
              <option value="auto">Recommended (Auto)</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3 mb-3 text-xs" style={{ color: "var(--ws-text-dim)" }}>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={useDatabase} onChange={(e) => setUseDatabase(e.target.checked)} />
            Database
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} />
            Web
          </label>
          <label className="inline-flex items-center gap-1.5">
            Lookback
            <input
              type="number"
              min={1}
              step={1}
              value={lookbackValue}
              onChange={(e) => setLookbackValue(e.target.value)}
              className="rounded px-1.5 py-0.5 text-xs w-14"
              style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
              aria-label="Lookback value"
            />
            <select
              value={lookbackUnit}
              onChange={(e) => setLookbackUnit(e.target.value as LookbackUnit)}
              className="rounded px-1.5 py-0.5 text-xs"
              style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
            >
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </label>
        </div>

        <label className="text-xs block mb-3 flex-1 min-h-0" style={{ color: "var(--ws-text-dim)" }}>
          Prompt template
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-1 w-full h-[calc(100%-1.25rem)] min-h-28 rounded px-2 py-1.5 text-sm resize-y"
            style={{ background: "var(--ws-bg3)", color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
            placeholder="Use markdown sections, lists, tables (when useful), and source links for figures."
          />
        </label>

        <div className="flex justify-end">
          <button
            type="button"
            className="px-2.5 py-1 text-xs rounded ws-focus-ring"
            style={{ background: "var(--ws-cyan)", color: "var(--ws-bg)" }}
            onClick={() => {
              const trimmedName = name.trim();
              const trimmedPrompt = prompt.trim();
              if (!trimmedName || !trimmedPrompt) return;
              const dataSources: ("database" | "web")[] = [];
              if (useDatabase) dataSources.push("database");
              if (useWeb) dataSources.push("web");
              const parsedLookback = Number(lookbackValue);
              onSubmit({
                name: trimmedName,
                prompt: trimmedPrompt,
                aiModel,
                dataSources: dataSources.length > 0 ? dataSources : ["database"],
                dataLookback:
                  Number.isFinite(parsedLookback) && parsedLookback > 0
                    ? { value: Math.max(1, Math.round(parsedLookback)), unit: lookbackUnit }
                    : null,
              });
            }}
          >
            {mode === "edit" ? "Save Changes" : "Create Insight"}
          </button>
        </div>
      </div>
    </div>
  );
}
