"use client";
import type { CustomPage } from "@/lib/custom-pages-storage";
import AIInsightFormCard, { type InsightInput } from "@/components/AIInsightFormCard";

type Props = {
  mode: "create" | "edit";
  initialPage?: CustomPage | null;
  onSubmit: (input: InsightInput) => void;
  onCancelEdit?: () => void;
};

export default function AIInsightFormPage({ mode, initialPage, onSubmit, onCancelEdit }: Props) {
  return (
    <div className="h-full min-h-0 overflow-hidden px-4 py-3" style={{ background: "var(--ws-bg2)" }}>
      <div className="h-full min-h-0 max-w-4xl mx-auto">
        <AIInsightFormCard mode={mode} initialPage={initialPage} onSubmit={onSubmit} onCancelEdit={onCancelEdit} />
      </div>
    </div>
  );
}
