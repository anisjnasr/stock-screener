"use client";

import { useRef, useEffect } from "react";
import { tokenize, tokenClass } from "@/lib/nino-script-tokens";

type NinoScriptEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
};

export default function NinoScriptEditor({
  value,
  onChange,
  placeholder = "e.g. P > 10 and MA(C, 50) > 500000",
  className = "",
  minHeight = "200px",
}: NinoScriptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

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
        {lineIndex < lines.length - 1 ? "\n" : null}
      </div>
    );
  });

  return (
    <div className={`relative rounded border border-zinc-300 dark:border-zinc-600 overflow-hidden bg-white dark:bg-zinc-900 ${className}`} style={{ minHeight }}>
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
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="absolute inset-0 w-full h-full resize-none overflow-auto bg-transparent text-transparent caret-zinc-900 dark:caret-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none px-3 py-2.5 text-sm font-mono z-10 selection:bg-blue-200 dark:selection:bg-blue-800"
        style={{ minHeight }}
        spellCheck={false}
      />
    </div>
  );
}
