import {
  CAPTURE_PALETTE_GROUPS,
  CAPTURE_PALETTES,
} from '../../../../../shared/capturePalettes';

export function buildCapturePaletteOptions(t: (k: string) => string) {
  return CAPTURE_PALETTE_GROUPS.map((group) => ({
    group: t(`capture.palette.${group}`),
    items: CAPTURE_PALETTES.filter((p) => p.group === group).map((p) => ({ value: p.key, label: p.label })),
  }));
}

/**
 * An llm step's Background stores the palette key only ('' = Settings › Card style's palette).
 * Solid/gradient/mesh, direction and width come from Card style when the step runs. Picking a
 * Background drops any stored `background` gradient, which would override Card style; nothing else
 * rewrites a saved step.
 */
export function withCapturePalette(
  config: Record<string, string>,
  paletteKey: string,
): Record<string, string> {
  const next: Record<string, string> = { ...config, palette: paletteKey };
  delete next.background;
  return next;
}
