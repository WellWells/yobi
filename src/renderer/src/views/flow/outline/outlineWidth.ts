export const OUTLINE_WIDTH_DEFAULT = 264;
const OUTLINE_WIDTH_MIN = 240;
const EDITOR_SPACE_MIN = 360;
const DRAWER_BACKDROP_SPACE = 32;

export function parseOutlineWidth(raw: string | null): number {
  const width = Number(raw);
  return Number.isFinite(width) && width >= OUTLINE_WIDTH_MIN ? Math.round(width) : OUTLINE_WIDTH_DEFAULT;
}

/** Only the displayed width is constrained; a smaller window must not erase the preference. */
export function outlineWidthLimits(editorWidth: number, narrow: boolean): { min: number; max: number } {
  const max = editorWidth > 0
    ? Math.max(0, Math.floor(editorWidth - (narrow ? DRAWER_BACKDROP_SPACE : EDITOR_SPACE_MIN)))
    : OUTLINE_WIDTH_DEFAULT;
  return { min: Math.min(OUTLINE_WIDTH_MIN, max), max };
}
