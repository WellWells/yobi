import { CAPTURE_PALETTES, buildCaptureBackground } from '../../../../../shared/capturePalettes';

export function buildCapturePaletteOptions(t: (k: string) => string) {
  return (['dark', 'light'] as const).map((card) => ({
    group: t(`capture.palette.${card}`),
    items: CAPTURE_PALETTES.filter((p) => p.card === card).map((p) => ({ value: p.key, label: p.label })),
  }));
}

export function applyCapturePalette(
  config: Record<string, string>,
  paletteKey: string,
): Record<string, string> {
  const palette = CAPTURE_PALETTES.find((p) => p.key === paletteKey) ?? CAPTURE_PALETTES[0];
  const background = buildCaptureBackground(palette.from, palette.to, 'se');
  return { ...config, palette: palette.key, background };
}
