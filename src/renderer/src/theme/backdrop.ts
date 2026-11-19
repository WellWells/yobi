import type { ThemeDef } from '../../../shared/themes';
import { hexToRgb, hexToRgba, lerpHex } from './colorUtils';

/*
 * A theme's drawn page background (the silk themes and the flowing one): soft sheets of colour and
 * a band of sheen over the page colour. It is painted by a shader (`backdropPainter.ts`); the
 * gradients built here are what shows where WebGL is not available, and the theme picker's dot.
 *
 * Text sits straight on it, so what it can show has to be known: every pixel is a mix of the page
 * colour, the sheets and the sheen, and `backdropColors` lists those and their mixes for the
 * contrast maths.
 */

/** How much of the panel colour a sidebar keeps over the backdrop; the rest shows through. */
export const BACKDROP_PANEL_ALPHA = 0.6;

/** The strongest the sheen band gets over what is under it. */
export const BACKDROP_SHEEN_ALPHA = 0.45;

function alphaHex(alpha: number): string {
  return Math.round(alpha * 255).toString(16).padStart(2, '0');
}

export interface BackdropLayers {
  /** The lower layer: two sheets from opposite corners. */
  back: string;
  /** The upper layer: the third sheet and the sheen band. */
  front: string;
  /** Both layers flattened over the page colour, for the theme picker's dot. */
  swatch: string;
}

/** The backdrop as plain linear gradients: linear keeps its angle at any window shape. */
export function backdropLayers(def: ThemeDef): BackdropLayers | null {
  if (!def.backdrop) return null;
  const [a, b, c] = def.backdrop.sheets;
  const { sheen } = def.backdrop;
  const back = [
    `linear-gradient(200deg, ${a} 0%, ${a}00 58%)`,
    `linear-gradient(20deg, ${b} 0%, ${b}00 52%)`,
  ].join(', ');
  const front = [
    `linear-gradient(118deg, ${sheen}00 36%, ${sheen}${alphaHex(BACKDROP_SHEEN_ALPHA)} 52%, ${sheen}26 63%, ${sheen}00 78%)`,
    `linear-gradient(105deg, ${c}d9 0%, ${c}00 46%)`,
  ].join(', ');
  const swatch = `linear-gradient(135deg, ${a}, ${def.colors.bgPrimary} 50%, ${b}), ${def.colors.bgPrimary}`;
  return { back, front, swatch };
}

/** The even mix of several colours, channel by channel. */
function blend(colors: readonly string[]): string {
  const sum = colors.reduce<[number, number, number]>((total, color) => {
    const [r, g, b] = hexToRgb(color);
    return [total[0] + r, total[1] + g, total[2] + b];
  }, [0, 0, 0]);
  return `#${sum.map((channel) => Math.round(channel / colors.length).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Every colour the bare page can show: the page colour and the sheets, the even mix of every two,
 * every three and all four of them (a mix can be darker than its parts, which matters under dark
 * text), and each of those under the sheen at its strongest.
 */
export function backdropColors(def: ThemeDef): string[] {
  if (!def.backdrop) return [];
  const solid = [def.colors.bgPrimary, ...def.backdrop.sheets];
  const pairs = solid.flatMap((first, i) => solid.slice(i + 1).map((second) => blend([first, second])));
  const triples = solid.map((_, skipped) => blend(solid.filter((__, index) => index !== skipped)));
  const mixed = [...solid, ...pairs, ...triples, blend(solid)];
  const lit = mixed.map((color) => lerpHex(color, def.backdrop!.sheen, BACKDROP_SHEEN_ALPHA));
  return [...new Set([...def.backdrop.sheets, ...pairs, ...triples, blend(solid), ...lit])];
}

/** What text and controls sit on besides the plain page, panels and cards: the backdrop, and a sidebar over it. */
export function backdropSurfaces(def: ThemeDef): string[] {
  const colors = backdropColors(def);
  const panels = colors.map((color) => lerpHex(color, def.colors.bgSurface, BACKDROP_PANEL_ALPHA));
  return [...new Set([...colors, ...panels])];
}

/** The sidebar's fill in a backdrop theme: its panel colour, part see-through. */
export function backdropPanelFill(def: ThemeDef): string {
  return hexToRgba(def.colors.bgSurface, BACKDROP_PANEL_ALPHA);
}
