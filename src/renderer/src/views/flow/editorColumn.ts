import type { CSSProperties } from 'react';

/** The flow editor's main column (the cards, and the top band over them). */
export const EDITOR_COLUMN = 560;
/**
 * The column once the editor is wide: the long-flow analysis's P3 (§2.2), so a form whose fields
 * fit side by side (`SimpleGrid type="container"`) can put them there. 720 is the Settings column.
 */
export const EDITOR_COLUMN_WIDE = 720;
/**
 * The editor width (its own, `useWidthBelow`, so zoomed text switches too) from which the column
 * widens. The wide column with its margins, gap and the outline beside it takes 1040
 * (720 + 2 × 20 + 16 + 264); the line sits 200 above that so the column is never pressed against
 * the outline. A 1280 window keeps 560, with the flow sidebar open (1040) or folded (1232).
 */
export const EDITOR_WIDE_MIN_WIDTH = 1240;

export function editorColumnWidth(wide: boolean): number {
  return wide ? EDITOR_COLUMN_WIDE : EDITOR_COLUMN;
}

/**
 * Each open card's form is a size container, so a form can lay its fields out by the width it has
 * (`@container step-form (min-width: …)` in a stylesheet). Mantine's `SimpleGrid type="container"`
 * brings its own container and needs nothing from this. Fixed-position descendants are placed
 * against the container: the menus inside forms are portalled, and the field context menu is
 * mounted at the App's root.
 */
export const STEP_FORM_CONTAINER: CSSProperties = { containerType: 'inline-size', containerName: 'step-form' };
