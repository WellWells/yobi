import type React from 'react';

/** The `!` shell mode's colour: the composer frame, its notice icon and the `!` of a ran command. */
export const SHELL_COLOR = 'var(--mantine-color-pink-6)';

const FRAME_TRANSITION = 'border-color 0.15s ease, box-shadow 0.15s ease';

const SHELL_TINT = {
  rest: SHELL_COLOR,
  focus: 'var(--mantine-color-pink-4)',
  ring: 'color-mix(in srgb, var(--mantine-color-pink-5) 25%, transparent)',
} as const;

const TEMPORARY_TINT = {
  rest: 'var(--mantine-color-violet-6)',
  focus: 'var(--mantine-color-violet-4)',
  ring: 'color-mix(in srgb, var(--mantine-color-violet-5) 25%, transparent)',
} as const;

/**
 * The composer's frame: the accent normally, violet and dashed in a temporary chat, and the shell
 * colour while the draft is a `!` command, so "this runs on your computer" shows before the send.
 * A temporary chat keeps its dashes under the shell colour, since both are still true.
 */
export function composerFrameStyle({ temporary, shell, focused }: {
  temporary: boolean;
  shell: boolean;
  focused: boolean;
}): React.CSSProperties {
  const tint = shell ? SHELL_TINT : temporary ? TEMPORARY_TINT : null;
  if (!tint) {
    return {
      borderColor: focused ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default-border)',
      boxShadow: focused ? '0 0 0 2px var(--mantine-color-accent-dim)' : 'none',
      transition: FRAME_TRANSITION,
      cursor: 'text',
    };
  }
  return {
    ...(temporary ? {
      borderStyle: 'dashed',
      background: 'color-mix(in srgb, var(--mantine-color-default) 82%, transparent)',
    } : {}),
    borderColor: focused ? tint.focus : tint.rest,
    boxShadow: focused ? `0 0 0 2px ${tint.ring}` : 'none',
    transition: FRAME_TRANSITION,
    cursor: 'text',
  };
}

/**
 * Whether a click that bubbled up to the composer frame should put the caret in the prompt. A mouse
 * click anywhere on the frame does (it is one big text field). A keyboard-activated click — Enter or
 * Space on a pill or a menu row, which arrives with `detail === 0` — does not: focus stays on the
 * pill, and Mantine hands it back to the pill when its menu closes (WCAG 2.4.3). Menu rows are
 * portalled, but React still bubbles their clicks here.
 */
export function frameClickFocusesPrompt(event: { detail: number }): boolean {
  return event.detail > 0;
}
