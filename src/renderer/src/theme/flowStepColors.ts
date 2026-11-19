import { FLOW_STEP_COLORS, readFlowStepColor } from '../../../shared/flowStepColor';
import type { FlowStepColor } from '../../../shared/flowStepColor';
import type { ThemeColors } from '../../../shared/themes';
import { contrastRatio, lerpHex } from './colorUtils';

/** Annotation hues have no status meaning; the theme still owns warnings and errors. */
const HUES: Record<FlowStepColor, string> = {
  blue: '#5999df', cyan: '#45aeb8', green: '#77a962', yellow: '#c7ad48',
  orange: '#d08c50', pink: '#c97fa8', violet: '#9d80d0', gray: '#8e97a4',
};

/** Opaque fills also cover a form as its sticky header scrolls over it. */
export function flowStepColorVars(base: ThemeColors, light: boolean): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const color of FLOW_STEP_COLORS) {
    let background = base.bgPrimary;
    for (let percent = light ? 16 : 20; percent >= 0; percent -= 1) {
      background = lerpHex(base.bgPrimary, HUES[color], percent / 100);
      if (contrastRatio(base.textPrimary, background) >= 4.5
        && contrastRatio(base.textSecondary, background) >= 4.5) break;
    }
    let mark = HUES[color];
    for (let percent = 0; percent <= 100; percent += 5) {
      mark = lerpHex(HUES[color], light ? '#000000' : '#ffffff', percent / 100);
      if (contrastRatio(mark, base.bgPrimary) >= 3) break;
    }
    vars[`--flow-step-${color}-bg`] = background;
    vars[`--flow-step-${color}-mark`] = mark;
    let muted = base.textMuted;
    for (let percent = 0; percent <= 100; percent += 5) {
      muted = lerpHex(base.textMuted, base.textPrimary, percent / 100);
      if (contrastRatio(muted, background) >= 4.5) break;
    }
    vars[`--flow-step-${color}-muted`] = muted;
  }
  return vars;
}

export function stepColorBackground(value: unknown): string | undefined {
  const color = readFlowStepColor(value);
  return color ? `var(--flow-step-${color}-bg)` : undefined;
}

export function stepColorMark(value: unknown): string | undefined {
  const color = readFlowStepColor(value);
  return color ? `var(--flow-step-${color}-mark)` : undefined;
}

/** A coloured card's small summaries and field hints need the same legibility as its title. */
export function stepColorTextVars(value: unknown): Record<string, string> {
  const color = readFlowStepColor(value);
  if (!color) return {};
  const muted = `var(--flow-step-${color}-muted)`;
  return { '--text-muted': muted, '--mantine-color-dimmed': muted };
}
