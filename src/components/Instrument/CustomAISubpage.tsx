"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { Quote, CompanyProfile, NewsItem } from "@/lib/types";

export function CustomAISubpage({
  symbol,
  promptId,
}: {
  symbol: string;
  promptId: string;
}) {
  const [promptText, setPromptText] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.prompts
      .get(promptId)
      .then((p: { title?: string; prompt_text?: string }) => {
        if (cancelled) return;
        setTitle(p.title ?? "Custom");
        setPromptText(p.prompt_text ?? "");
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message ?? "Prompt not found");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [promptId]);

  useEffect(() => {
    if (!promptText || error) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.quote(symbol), api.profile(symbol), api.news(symbol)])
      .then(([quote, profile, news]) => {
        if (cancelled) return;
        const context = {
          lastPrice: (quote as Quote).price,
          changePercent: (quote as Quote).changePercent,
          companyName: (profile as CompanyProfile).name,
          industry: (profile as CompanyProfile).industry,
          newsSummary: (news as NewsItem[]).slice(0, 5).map((n) => n.headline),
        };
        return api.aiRun(promptText, symbol, context);
      })
      .then((res) => {
        if (cancelled) return;
        setText((res as { text: string }).text ?? "");
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message ?? "Analysis failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [symbol, promptText, error]);

  if (error && !title) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-900/10 p-4 text-red-400">
        {error}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
        <div className="text-zinc-400">Running analysis…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-900/10 p-4 text-red-400">
        {error}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
      <div className="prose prose-invert max-w-none whitespace-pre-wrap text-zinc-200">
        {text}
      </div>
    </div>
  );
}
