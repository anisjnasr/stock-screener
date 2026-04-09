/** Approximate width of flag strip (clear + 5 colors, gaps, padding; chart toolbar uses larger gap). */
export const FLAG_STRIP_APPROX_WIDTH_PX = 260;
/** Approximate height for vertical flip / clamping. */
export const FLAG_STRIP_APPROX_HEIGHT_PX = 44;

const DEFAULT_MARGIN = 8;

/**
 * Position a horizontal flag strip fixed below the anchor (or above if needed),
 * right-aligned to the anchor, then clamped so the full strip stays in the viewport.
 */
export function computeFlagStripPosition(
  anchor: DOMRect,
  width = FLAG_STRIP_APPROX_WIDTH_PX,
  height = FLAG_STRIP_APPROX_HEIGHT_PX,
  margin = DEFAULT_MARGIN
): { top: number; left: number } {
  if (typeof window === "undefined") {
    return { top: anchor.bottom + 2, left: Math.max(margin, anchor.right - width) };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = anchor.bottom + 2;
  if (top + height > vh - margin) {
    top = Math.max(margin, anchor.top - height - 2);
  }
  let left = anchor.right - width;
  left = Math.max(margin, Math.min(left, vw - width - margin));
  return { top, left };
}
