"use client";

import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import {
  type FilterOperator,
  type ColumnFilterDef,
  type TopBottomFilter,
  FILTER_OPERATORS_NUMERIC,
  FILTER_OPERATORS_TEXT,
  NUMERIC_COLUMN_IDS,
  type ColumnId,
} from "@/lib/watchlist-storage";

type Tab = "value" | "topbottom";

interface ColumnFilterPopoverProps {
  column: string;
  columnLabel: string;
  anchorRect: DOMRect | null;
  currentFilter: ColumnFilterDef | undefined;
  currentTopBottom: TopBottomFilter | null;
  onApplyFilter: (column: string, filter: ColumnFilterDef) => void;
  onClearFilter: (column: string) => void;
  onApplyTopBottom: (tb: TopBottomFilter) => void;
  onClearTopBottom: () => void;
  onClose: () => void;
}

export default function ColumnFilterPopover({
  column,
  columnLabel,
  anchorRect,
  currentFilter,
  currentTopBottom,
  onApplyFilter,
  onClearFilter,
  onApplyTopBottom,
  onClearTopBottom,
  onClose,
}: ColumnFilterPopoverProps) {
  const isNumeric = NUMERIC_COLUMN_IDS.has(column as ColumnId);
  const hasTopBottom = currentTopBottom?.column === column;

  const [tab, setTab] = useState<Tab>(hasTopBottom ? "topbottom" : "value");
  const [operator, setOperator] = useState<FilterOperator>(currentFilter?.operator ?? ">=");
  const [value, setValue] = useState(currentFilter?.value?.toString() ?? "");
  const [tbMode, setTbMode] = useState<"top" | "bottom">(currentTopBottom?.mode ?? "top");
  const [tbCount, setTbCount] = useState(currentTopBottom?.count?.toString() ?? "10");

  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [tab]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const handleApplyValue = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const parsed = isNumeric ? Number(trimmed) : trimmed;
    if (isNumeric && !Number.isFinite(parsed as number)) return;
    onApplyFilter(column, { operator, value: parsed });
    onClose();
  }, [column, operator, value, isNumeric, onApplyFilter, onClose]);

  const handleApplyTopBottom = useCallback(() => {
    const count = Math.max(1, Math.round(Number(tbCount) || 10));
    onApplyTopBottom({ column, mode: tbMode, count });
    onClose();
  }, [column, tbMode, tbCount, onApplyTopBottom, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (tab === "value") handleApplyValue();
        else handleApplyTopBottom();
      }
    },
    [tab, handleApplyValue, handleApplyTopBottom],
  );

  const operators = isNumeric ? FILTER_OPERATORS_NUMERIC : FILTER_OPERATORS_TEXT;

  if (!anchorRect) return null;

  const popoverWidth = 240;
  let left = anchorRect.left;
  if (left + popoverWidth > window.innerWidth - 8) {
    left = window.innerWidth - popoverWidth - 8;
  }
  if (left < 8) left = 8;
  const top = anchorRect.bottom + 4;

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999] rounded-lg shadow-2xl"
      style={{
        left,
        top,
        width: popoverWidth,
        background: "var(--ws-bg2, #1a1a1a)",
        border: "1px solid var(--ws-border-hover, #333)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="px-3 pt-2.5 pb-1.5 text-[11px] font-semibold truncate"
        style={{ color: "var(--ws-text, #e5e5e5)" }}
      >
        Filter: {columnLabel}
      </div>

      {/* Tabs */}
      {isNumeric && (
        <div className="flex mx-2 mb-2 rounded-md overflow-hidden" style={{ border: "1px solid var(--ws-border, #262626)" }}>
          <button
            type="button"
            onClick={() => setTab("value")}
            className="flex-1 py-1 text-[10px] font-medium transition-colors"
            style={{
              background: tab === "value" ? "rgba(0,229,204,0.12)" : "transparent",
              color: tab === "value" ? "var(--ws-cyan, #00e5cc)" : "var(--ws-text-dim, #888)",
            }}
          >
            Value
          </button>
          <button
            type="button"
            onClick={() => setTab("topbottom")}
            className="flex-1 py-1 text-[10px] font-medium transition-colors"
            style={{
              background: tab === "topbottom" ? "rgba(0,229,204,0.12)" : "transparent",
              color: tab === "topbottom" ? "var(--ws-cyan, #00e5cc)" : "var(--ws-text-dim, #888)",
              borderLeft: "1px solid var(--ws-border, #262626)",
            }}
          >
            Top / Bottom
          </button>
        </div>
      )}

      {/* Value filter tab */}
      {tab === "value" && (
        <div className="px-3 pb-3">
          <div className="flex gap-1.5 mb-2">
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as FilterOperator)}
              className="rounded px-1.5 py-1 text-[11px] outline-none"
              style={{
                background: "var(--ws-bg3, #222)",
                color: "var(--ws-text, #e5e5e5)",
                border: "1px solid var(--ws-border, #262626)",
                width: 56,
              }}
            >
              {operators.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input
              ref={inputRef}
              type={isNumeric ? "number" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isNumeric ? "e.g. 5" : "e.g. AAPL"}
              className="flex-1 rounded px-2 py-1 text-[11px] outline-none min-w-0"
              style={{
                background: "var(--ws-bg3, #222)",
                color: "var(--ws-text, #e5e5e5)",
                border: "1px solid var(--ws-border, #262626)",
              }}
              step="any"
            />
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleApplyValue}
              disabled={!value.trim()}
              className="flex-1 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors"
              style={{
                background: value.trim() ? "rgba(0,229,204,0.15)" : "rgba(0,229,204,0.05)",
                color: value.trim() ? "var(--ws-cyan, #00e5cc)" : "var(--ws-text-dim, #555)",
                border: "1px solid rgba(0,229,204,0.25)",
                cursor: value.trim() ? "pointer" : "default",
              }}
            >
              Apply
            </button>
            {currentFilter && (
              <button
                type="button"
                onClick={() => { onClearFilter(column); onClose(); }}
                className="py-1 px-3 rounded text-[10px] font-medium transition-colors"
                style={{
                  background: "rgba(255,77,106,0.08)",
                  color: "var(--ws-red, #ff4d6a)",
                  border: "1px solid rgba(255,77,106,0.2)",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top/Bottom N tab */}
      {tab === "topbottom" && isNumeric && (
        <div className="px-3 pb-3">
          <div className="flex gap-1.5 mb-2">
            <select
              value={tbMode}
              onChange={(e) => setTbMode(e.target.value as "top" | "bottom")}
              className="rounded px-1.5 py-1 text-[11px] outline-none"
              style={{
                background: "var(--ws-bg3, #222)",
                color: "var(--ws-text, #e5e5e5)",
                border: "1px solid var(--ws-border, #262626)",
                width: 80,
              }}
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
            <input
              ref={tab === "topbottom" ? inputRef : undefined}
              type="number"
              min={1}
              max={9999}
              value={tbCount}
              onChange={(e) => setTbCount(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="10"
              className="flex-1 rounded px-2 py-1 text-[11px] outline-none min-w-0"
              style={{
                background: "var(--ws-bg3, #222)",
                color: "var(--ws-text, #e5e5e5)",
                border: "1px solid var(--ws-border, #262626)",
              }}
            />
            <span className="text-[11px] self-center whitespace-nowrap" style={{ color: "var(--ws-text-dim, #888)" }}>
              rows
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleApplyTopBottom}
              className="flex-1 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
              style={{
                background: "rgba(0,229,204,0.15)",
                color: "var(--ws-cyan, #00e5cc)",
                border: "1px solid rgba(0,229,204,0.25)",
              }}
            >
              Apply
            </button>
            {hasTopBottom && (
              <button
                type="button"
                onClick={() => { onClearTopBottom(); onClose(); }}
                className="py-1 px-3 rounded text-[10px] font-medium transition-colors cursor-pointer"
                style={{
                  background: "rgba(255,77,106,0.08)",
                  color: "var(--ws-red, #ff4d6a)",
                  border: "1px solid rgba(255,77,106,0.2)",
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
