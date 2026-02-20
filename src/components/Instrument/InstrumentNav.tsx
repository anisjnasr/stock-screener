"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { SavedPrompt } from "@/lib/types";

const PREDEFINED: { slug: string; label: string }[] = [
  { slug: "market-positioning", label: "Market positioning" },
  { slug: "industry-analysis", label: "Industry analysis" },
  { slug: "competitors", label: "Competitors" },
  { slug: "strengths-weaknesses", label: "Strengths & weaknesses" },
  { slug: "earnings-analysis", label: "Earnings analysis" },
];

export function InstrumentNav() {
  const params = useParams();
  const pathname = usePathname();
  const symbol = (params?.symbol as string) ?? "";
  const [customPrompts, setCustomPrompts] = useState<SavedPrompt[]>([]);
  const [showNewPrompt, setShowNewPrompt] = useState(false);

  useEffect(() => {
    api.prompts
      .list()
      .then((list) => setCustomPrompts(Array.isArray(list) ? list : []))
      .catch(() => setCustomPrompts([]));
  }, []);

  const base = `/instruments/${encodeURIComponent(symbol)}`;
  const isOverview = pathname === base;

  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-zinc-700 pb-2">
      <Link
        href={base}
        className={`rounded px-3 py-1.5 text-sm ${
          isOverview
            ? "bg-zinc-700 text-white"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
        }`}
      >
        Overview
      </Link>
      {PREDEFINED.map(({ slug, label }) => {
        const href = `${base}/${slug}`;
        const active = pathname === href;
        return (
          <Link
            key={slug}
            href={href}
            className={`rounded px-3 py-1.5 text-sm ${
              active
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {label}
          </Link>
        );
      })}
      {customPrompts.map((p) => {
        const href = `${base}/custom/${encodeURIComponent(p.id)}`;
        const active = pathname === href;
        return (
          <Link
            key={p.id}
            href={href}
            className={`rounded px-3 py-1.5 text-sm ${
              active
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {p.title}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setShowNewPrompt(true)}
        className="rounded border border-dashed border-zinc-500 px-3 py-1.5 text-sm text-zinc-400 hover:border-emerald-500 hover:text-emerald-400"
      >
        + Custom
      </button>
      {showNewPrompt && (
        <NewPromptModal
          onClose={() => setShowNewPrompt(false)}
          onSaved={() => {
            setShowNewPrompt(false);
            api.prompts.list().then((list) => setCustomPrompts(Array.isArray(list) ? list : []));
          }}
        />
      )}
    </nav>
  );
}

function NewPromptModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.prompts.create(title.trim(), promptText.trim());
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 p-4 shadow-xl">
        <h3 className="mb-3 font-semibold text-white">Create custom subpage</h3>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title"
          className="mb-2 w-full rounded border border-zinc-600 bg-zinc-700 px-3 py-2 text-white placeholder-zinc-500"
        />
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="Prompt (e.g. Summarize key risks for a retail trader)"
          rows={4}
          className="mb-4 w-full rounded border border-zinc-600 bg-zinc-700 px-3 py-2 text-white placeholder-zinc-500"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !title.trim()}
            className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
