/** Each segment's own horizontal padding plus the control's frame, in px at 100% text size. */
const SEGMENT_PADDING = 20;
const CONTROL_FRAME = 12;
/** A CJK character at the label size is about a full em; Latin text averages a little over half. */
const WIDE_CHAR = 14;
const NARROW_CHAR = 7.5;

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? WIDE_CHAR : NARROW_CHAR;
  return width;
}

/**
 * Roughly how wide a segmented control must be to show every label whole, at 100% system text size
 * (`useWidthBelow` scales it). Below it the labels end in "…" — "手..", "快.." — and a choice
 * nobody can read is no choice (WCAG 1.4.10 Reflow): the caller swaps in a select instead.
 */
export function segmentsMinWidth(labels: readonly string[]): number {
  return Math.ceil(CONTROL_FRAME + labels.reduce((sum, label) => sum + SEGMENT_PADDING + textWidth(label), 0));
}
