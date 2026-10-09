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
 * Merges the shared input styling with the caller's `styles`, slot by slot, so an override adds to
 * the shared styles instead of replacing them. Object form only, like `SelectDropdown`.
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
