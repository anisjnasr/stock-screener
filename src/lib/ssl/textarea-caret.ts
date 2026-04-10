/**
 * Caret position in viewport coordinates for positioning autocomplete under the textarea caret.
 */

export function getTextareaCaretClientPosition(
  textarea: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  const taRect = textarea.getBoundingClientRect();
  const cs = getComputedStyle(textarea);

  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.top = `${taRect.top}px`;
  div.style.left = `${taRect.left}px`;
  div.style.width = `${textarea.clientWidth}px`;
  div.style.height = `${textarea.clientHeight}px`;
  div.style.overflow = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.visibility = "hidden";
  div.style.pointerEvents = "none";
  div.style.zIndex = "-1";

  div.style.font = cs.font;
  div.style.fontSize = cs.fontSize;
  div.style.fontFamily = cs.fontFamily;
  div.style.fontWeight = cs.fontWeight;
  div.style.fontStyle = cs.fontStyle;
  div.style.lineHeight = cs.lineHeight;
  div.style.letterSpacing = cs.letterSpacing;
  div.style.padding = cs.padding;
  div.style.border = cs.border;
  div.style.boxSizing = cs.boxSizing;
  div.style.tabSize = cs.tabSize;

  div.scrollTop = textarea.scrollTop;
  div.scrollLeft = textarea.scrollLeft;

  const before = textarea.value.slice(0, position);
  const lead = document.createElement("span");
  lead.textContent = before;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  div.appendChild(lead);
  div.appendChild(marker);

  document.body.appendChild(div);
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(div);

  return { top: markerRect.top, left: markerRect.left };
}
