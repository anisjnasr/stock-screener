"use client";

import { useRef, useEffect, useState, useCallback, useLayoutEffect } from "react";
import { tokenize, tokenClass } from "@/lib/ssl/tokens";
import { parseScript, ParseError } from "@/lib/ssl/parser";
import { filterCompletions, type SslCompletionItem } from "@/lib/ssl/completions";
import { normalizeSslText } from "@/lib/ssl/formatting";
import { getTextareaCaretClientPosition } from "@/lib/ssl/textarea-caret";

export type ValidationStatus = { status: "ok" | "invalid" | "empty"; error?: string };

type SSLEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  onValidation?: (status: ValidationStatus) => void;
};

function wordAtCaret(text: string, caret: number): { start: number; end: number; prefix: string } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) start--;
  let end = caret;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end++;
  return { start, end, prefix: text.slice(start, end) };
}

/** Crude: true if caret is after // on the same line (good enough for SSL // comments). */
function isCaretInLineComment(text: string, caret: number): boolean {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  return before.slice(lineStart).includes("//");
}

export default function SSLEditor({
  value,
  onChange,
  placeholder = 'e.g. C > 10 AND MA(V, 20) >= 500000 AND RS(12) >= 90;',
  className = "",
  minHeight = "200px",
  onValidation,
}: SSLEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [validation, setValidation] = useState<ValidationStatus>({ status: "empty" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuItems, setMenuItems] = useState<SslCompletionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const replaceRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  /** After controlled `value` updates, restore textarea selection (normalization runs on each keystroke). */
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  const handleChangeRaw = useCallback(
    (raw: string) => {
      onChange(normalizeSslText(raw));
    },
    [onChange]
  );

  const updateMenuPosition = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const { top, left } = getTextareaCaretClientPosition(ta, caret);
    const lineHeight = 18;
    const pad = 8;
    const maxLeft = typeof window !== "undefined" ? window.innerWidth - 280 : left;
    setMenuPos({
      top: top + lineHeight,
      left: Math.max(pad, Math.min(left, maxLeft)),
    });
  }, []);

  const closeCompletions = useCallback(() => {
    setMenuOpen(false);
    setMenuItems([]);
  }, []);

  /**
   * Refresh suggestion list at caret. `allowEmptyPrefix` is for Ctrl+Space (show all when not in an identifier).
   */
  const refreshCompletionsAt = useCallback(
    (text: string, caret: number, allowEmptyPrefix: boolean) => {
      if (isCaretInLineComment(text, caret)) {
        closeCompletions();
        return;
      }
      const bounds = wordAtCaret(text, caret);
      const { prefix } = bounds;
      if (!allowEmptyPrefix) {
        if (prefix.length < 1 || !/^[A-Za-z_]/.test(prefix[0]!)) {
          closeCompletions();
          return;
        }
      }
      replaceRangeRef.current = { start: bounds.start, end: bounds.end };
      const list = filterCompletions(text, prefix);
      if (list.length === 0) {
        closeCompletions();
        return;
      }
      setMenuItems(list);
      setActiveIndex(0);
      setMenuOpen(true);
      requestAnimationFrame(() => updateMenuPosition());
    },
    [closeCompletions, updateMenuPosition]
  );

  const openCompletions = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    refreshCompletionsAt(value, ta.selectionStart, true);
  }, [value, refreshCompletionsAt]);

  const applyCompletion = useCallback(
    (item: SslCompletionItem) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { start, end } = replaceRangeRef.current;
      const next = value.slice(0, start) + item.insertText + value.slice(end);
      handleChangeRaw(next);
      const pos = start + item.insertText.length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
      closeCompletions();
    },
    [value, closeCompletions, handleChangeRaw]
  );

  useEffect(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    const syncScroll = () => {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    };
    const onScroll = () => {
      syncScroll();
      if (menuOpen) updateMenuPosition();
    };
    ta.addEventListener("scroll", onScroll);
    return () => ta.removeEventListener("scroll", onScroll);
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!value.trim()) {
      const s: ValidationStatus = { status: "empty" };
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setValidation(s);
        onValidation?.(s);
      });
      return () => {
        cancelled = true;
      };
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

  useLayoutEffect(() => {
    const p = pendingSelectionRef.current;
    const ta = textareaRef.current;
    pendingSelectionRef.current = null;
    if (!p || !ta) return;
    const start = Math.max(0, Math.min(p.start, ta.value.length));
    const end = Math.max(0, Math.min(p.end, ta.value.length));
    ta.setSelectionRange(start, end);
  }, [value]);

  /** Re-filter or close when script changes while menu is open. */
  useLayoutEffect(() => {
    if (!menuOpen) return;
    let cancelled = false;
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const bounds = wordAtCaret(value, caret);
    replaceRangeRef.current = { start: bounds.start, end: bounds.end };
    const list = filterCompletions(value, bounds.prefix);
    queueMicrotask(() => {
      if (cancelled) return;
      if (list.length === 0) {
        closeCompletions();
        return;
      }
      setMenuItems(list);
      setActiveIndex((i) => Math.min(i, list.length - 1));
      updateMenuPosition();
    });
    return () => {
      cancelled = true;
    };
  }, [value, menuOpen, closeCompletions, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (textareaRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      closeCompletions();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, closeCompletions]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    const caret = e.target.selectionStart;
    const selEnd = e.target.selectionEnd;
    const normalized = normalizeSslText(raw);
    if (normalized !== raw) {
      pendingSelectionRef.current = {
        start: Math.min(caret, normalized.length),
        end: Math.min(selEnd, normalized.length),
      };
    } else {
      pendingSelectionRef.current = null;
    }
    onChange(normalized);
    refreshCompletionsAt(normalized, Math.min(caret, normalized.length), false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      if (menuOpen) closeCompletions();
      else openCompletions();
      return;
    }

    if (menuOpen && menuItems.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCompletions();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % menuItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = menuItems[activeIndex];
        if (item) applyCompletion(item);
        return;
      }
    }
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
        <span className="opacity-0">.</span>
        {lineIndex < lines.length - 1 ? "\n" : null}
      </div>
    );
  });

  const kindLabel = (k: SslCompletionItem["kind"]) => {
    switch (k) {
      case "function":
        return "fn";
      case "keyword":
        return "kw";
      case "variable":
        return "var";
      case "field":
        return "fld";
      case "user":
        return "you";
      default:
        return "";
    }
  };

  return (
    <div className={`flex flex-col ${className}`}>
           <div
        className="relative rounded-t border border-zinc-300 dark:border-zinc-600 overflow-hidden bg-white dark:bg-zinc-900 flex-1"
        style={{ minHeight }}
      >
        <div
          ref={highlightRef}
          className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-sm font-mono pointer-events-none z-0"
          style={{ minHeight }}
          aria-hidden
        >
          {value ? highlightedLines : "\u00a0"}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextareaChange}
          onKeyDown={onKeyDown}
          onKeyUp={() => menuOpen && requestAnimationFrame(() => updateMenuPosition())}
          onClick={(e) => {
            const ta = e.currentTarget;
            requestAnimationFrame(() => {
              refreshCompletionsAt(ta.value, ta.selectionStart, false);
            });
          }}
          placeholder={placeholder}
          aria-label="SSL script editor"
          aria-autocomplete="list"
          aria-controls={menuOpen ? "ssl-completion-list" : undefined}
          aria-activedescendant={menuOpen && menuItems[activeIndex] ? `ssl-completion-${activeIndex}` : undefined}
          className="absolute inset-0 w-full h-full resize-none overflow-auto bg-transparent text-transparent caret-zinc-900 dark:caret-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-inset px-3 py-2.5 text-sm font-mono z-10 selection:bg-blue-400/35 dark:selection:bg-cyan-400/25"
          style={{ minHeight }}
          spellCheck={false}
        />
        {menuOpen && menuItems.length > 0 ? (
          <div
            ref={listRef}
            id="ssl-completion-list"
            role="listbox"
            className="fixed z-[80] max-h-48 min-w-[12rem] max-w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 shadow-lg py-1 text-xs font-mono"
            style={{
              top: menuPos.top,
              left: menuPos.left,
            }}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
              SSL — type to filter · Ctrl+Space
            </div>
            {menuItems.map((item, i) => (
              <button
                key={`${item.label}-${i}`}
                type="button"
                id={`ssl-completion-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`w-full text-left px-2 py-1 flex gap-2 items-baseline ${
                  i === activeIndex ? "bg-cyan-500/15 text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"
                }`}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  applyCompletion(item);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="shrink-0 w-7 text-[10px] text-zinc-500 dark:text-zinc-400">{kindLabel(item.kind)}</span>
                <span className="font-medium shrink-0">{item.label}</span>
                {item.detail ? (
                  <span className="truncate text-zinc-500 dark:text-zinc-400 font-normal">{item.detail}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
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
