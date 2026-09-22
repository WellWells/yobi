import type { CSSProperties } from 'react';

type AppInputTone = 'default' | 'body' | 'tertiary' | 'accent' | 'recording';
type AppInputResize = 'none' | 'vertical';

interface BuildInputStylesOptions {
  tone?: AppInputTone;
  mono?: boolean;
  numeric?: boolean;
  resize?: AppInputResize;
}

function resolveInputBackground(tone: AppInputTone): string {
  switch (tone) {
    case 'body':
    case 'accent':
      return 'var(--mantine-color-body)';
    case 'recording':
      return 'var(--mantine-color-accent-dim)';
    case 'tertiary':
    default:
      return 'var(--mantine-color-bg-tertiary)';
  }
}

export function buildInputStyles({
  tone = 'default',
  mono = false,
  numeric = false,
  resize = 'none',
}: BuildInputStylesOptions = {}) {
  return {
    input: {
      background: resolveInputBackground(tone),
      borderColor: tone === 'accent' || tone === 'recording'
        ? 'var(--mantine-color-accent)'
        : 'var(--mantine-color-default-border)',
      color: 'var(--mantine-color-default-color)',
      fontSize: 'var(--font-size-md)',
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
      textAlign: numeric ? 'right' : undefined,
      resize: resize === 'vertical' ? 'vertical' : 'none',
      overflowY: resize === 'vertical' ? 'auto' : undefined,
    },
    section: {
      color: 'var(--mantine-color-dimmed)',
    },
    label: {
      color: 'var(--mantine-color-default-color)',
      fontSize: 'var(--font-size-base)',
      fontWeight: 600,
    },
    description: {
      color: 'var(--mantine-color-dimmed)',
      fontSize: 'var(--font-size-sm)',
    },
    error: {
      fontSize: 'var(--font-size-sm)',
    },
  } as const;
}

type InputStyleSlots = Record<string, CSSProperties>;

/**
 * Merges the shared input styling with whatever the caller passed, slot by slot.
 *
 * The wrappers spread `{...props}` after `styles=`, so a caller passing `styles` replaced the
 * whole shared object rather than adding to it: SearchPalette asked for a transparent
 * background and silently lost the font size, the label weight, the section colour and the
 * error size along with it. AppModal and SelectDropdown already merge; these now match.
 *
 * Object form only, like `SelectDropdown` — Mantine also accepts a function, but nothing in
 * the app passes one and merging one would mean wrapping the callback.
 */
export function mergeInputStyles(base: InputStyleSlots, override: unknown): InputStyleSlots {
  const merged: InputStyleSlots = { ...base };
  if (!override || typeof override !== 'object') return merged;
  for (const [slot, value] of Object.entries(override as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    merged[slot] = { ...(merged[slot] ?? {}), ...(value as CSSProperties) };
  }
  return merged;
}

export type { AppInputTone, AppInputResize, InputStyleSlots };
