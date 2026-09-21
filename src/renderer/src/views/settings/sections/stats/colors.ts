import type { MetricOutcome } from '../../../../../../shared/types';

/**
 * Status colors, not a categorical palette: they always ship beside a text label, never
 * carrying meaning on their own.
 */
export const OUTCOME_COLORS: Record<MetricOutcome, string> = {
  success: 'var(--mantine-color-teal-5)',
  failure: 'var(--mantine-color-red-5)',
  timeout: 'var(--mantine-color-orange-5)',
};

export const TOKEN_COLORS = {
  input: 'var(--mantine-color-blue-5)',
  output: 'var(--mantine-color-violet-5)',
} as const;
