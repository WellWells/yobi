import {
  CAPTURE_PALETTE_GROUPS,
  CAPTURE_PALETTES,
  captureBackgroundCss,
} from '../../../../../shared/capturePalettes';

export function buildCapturePaletteOptions(t: (k: string) => string) {
  return CAPTURE_PALETTE_GROUPS.map((group) => ({
    group: t(`capture.palette.${group}`),
    items: CAPTURE_PALETTES.filter((p) => p.group === group).map((p) => ({ value: p.key, label: p.label })),
  }));
}

export function applyCapturePalette(
  config: Record<string, string>,
  paletteKey: string,
): Record<string, string> {
  const palette = CAPTURE_PALETTES.find((p) => p.key === paletteKey) ?? CAPTURE_PALETTES[0];
  return { ...config, palette: palette.key, background: captureBackgroundCss(palette.key) };
}
