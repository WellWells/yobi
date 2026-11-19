import type { MetricDomain, MetricOutcome } from '../../../../../../shared/types';

/**
 * Status colors, not a categorical palette: they always ship beside a text label, never
 * carrying meaning on their own.
 */
export const OUTCOME_COLORS: Record<MetricOutcome, string> = {
  success: 'var(--mantine-color-success)',
  failure: 'var(--mantine-color-error)',
  timeout: 'var(--mantine-color-warning)',
};

/** The same outcomes as text or a small icon: the readable tones, ≥ 4.5:1 on every surface. */
export const OUTCOME_TEXT: Record<MetricOutcome, string> = {
  success: 'var(--success-text)',
  failure: 'var(--error-text)',
  timeout: 'var(--warning-text)',
};

/**
 * The per-domain swatches in a breakdown legend: the brand accent, a lighter step of it, then the
 * muted tone — always beside the domain's name, so they only need to tell the rows apart.
 */
export const DOMAIN_COLORS: Record<MetricDomain, string> = {
  chat: 'var(--mantine-color-accent)',
  agent: 'color-mix(in srgb, var(--mantine-color-accent) 50%, transparent)',
  flow: 'var(--mantine-color-dimmed)',
};

export const TOKEN_COLORS = {
  input: 'var(--mantine-color-blue-5)',
  output: 'var(--mantine-color-violet-5)',
} as const;
