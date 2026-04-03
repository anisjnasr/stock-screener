"use client";

import { useRef, useEffect, useState } from "react";
import { tokenize, tokenClass } from "@/lib/nino-script-tokens";
import { parseScript, ParseError } from "@/lib/nino-script";

export type ValidationStatus = { status: "ok" | "invalid" | "empty"; error?: string };

type NinoScriptEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  onValidation?: (status: ValidationStatus) => void;
};

export default function NinoScriptEditor({
  value,
  onChange,
  placeholder = "e.g. P > 10 and MA(C, 50) > 500000",
  className = "",
  minHeight = "200px",
  onValidation,
}: NinoScriptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [validation, setValidation] = useState<ValidationStatus>({ status: "empty" });

  useEffect(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    const syncScroll = () => {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    };
    ta.addEventListener("scroll", syncScroll);
    return () => ta.removeEventListener("scroll", syncScroll);
  }, []);

  useEffect(() => {
    if (!value.trim()) {
      const s: ValidationStatus = { status: "empty" };
      setValidation(s);
      onValidation?.(s);
      return;
    }
    const timer = setTimeout(() => {
      try {
        parseScript(value.trim());
        const s: ValidationStatus = { status: "ok" };
        setValidation(s);
        onValidation?.(s);
      } catch (e) {
        const msg = e instanceof ParseError ? e.message : e instanceof Error ? e.message : "Parse error";
        const s: ValidationStatus = { status: "invalid", error: msg };
        setValidation(s);
        onValidation?.(s);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [value, onValidation]);

  const handleChange = (raw: string) => {
    const lines = raw.split("\n");
    const normalized = lines
      .map((line) => {
        const tokens = tokenize(line);
        return tokens
          .map((t) => {
            if (t.type === "number" || t.type === "space" || t.type === "punctuation") {
              return t.value;
            }
            return t.value.toUpperCase();
          })
          .join("");
      })
      .join("\n");
    onChange(normalized);
  };

  const lines = value.split("\n");
  const highlightedLines = lines.map((line, lineIndex) => {
    const tokens = tokenize(line);
    return (
      <div key={lineIndex} className="leading-normal">
        {tokens.map((t, i) => (
          <span key={i} className={tokenClass(t.type)}>
            {t.value}
          </span>
        ))}
        {/* Invisible trailing glyph so the highlight and caret stay perfectly aligned */}
        <span className="opacity-0">.</span>
        {lineIndex < lines.length - 1 ? "\n" : null}
      </div>
    );
  });

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="relative rounded-t border border-zinc-300 dark:border-zinc-600 overflow-hidden bg-white dark:bg-zinc-900 flex-1" style={{ minHeight }}>
        {/* Highlight layer (behind): colored tokens */}
        <div
          ref={highlightRef}
          className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-sm font-mono pointer-events-none z-0"
          style={{ minHeight }}
          aria-hidden
        >
          {value ? highlightedLines : "\u00a0"}
        </div>
        {/* Textarea on top: transparent text so highlight shows through, caret visible */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          aria-label="NinoScript editor"
          className="absolute inset-0 w-full h-full resize-none overflow-auto bg-transparent text-transparent caret-zinc-900 dark:caret-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-inset px-3 py-2.5 text-sm font-mono z-10 selection:bg-blue-200 dark:selection:bg-blue-800"
          style={{ minHeight }}
          spellCheck={false}
        />
      </div>
      {validation.status !== "empty" && (
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-b border border-t-0 border-zinc-300 dark:border-zinc-600 text-xs font-medium"
          style={{
            background: validation.status === "ok" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: validation.status === "ok" ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)",
          }}
        >
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "currentColor" }} />
          {validation.status === "ok" ? "OK" : `Invalid — ${validation.error}`}
        </div>
      )}
    </div>
  );
}
