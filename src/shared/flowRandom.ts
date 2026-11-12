/** The Random step's bounds, shared by the runner and the editor so both say the same thing. */
export const RANDOM_MAX_COUNT = 10_000;
export const RANDOM_DEFAULT_MIN = 1;
export const RANDOM_DEFAULT_MAX = 100;
export const RANDOM_DEFAULT_COUNT = 1;

const WHOLE_VARIABLE = /^\{\{[^{}]+\}\}$/;
const INTEGER = /^-?\d+$/;

/** What a min, max or count field holds: blank (the default), a whole number, one variable, or neither. */
export type RandomFieldValue =
  | { kind: 'blank' }
  | { kind: 'number'; value: number }
  | { kind: 'variable' }
  | { kind: 'invalid' };

export function readRandomField(raw: string | undefined): RandomFieldValue {
  const text = (raw ?? '').trim();
  if (!text) return { kind: 'blank' };
  if (WHOLE_VARIABLE.test(text)) return { kind: 'variable' };
  if (!INTEGER.test(text)) return { kind: 'invalid' };
  return { kind: 'number', value: Number(text) };
}

/** `format`: not a whole number or one variable; `unsafe`: past the safe integers; `countRange`: below 1. */
export type RandomFieldIssue = 'format' | 'unsafe' | 'countRange';

export interface RandomFormFacts {
  min?: RandomFieldIssue;
  max?: RandomFieldIssue;
  count?: RandomFieldIssue;
  /** How many numbers are drawn, when the count is known before the run (blank = 1). */
  countValue?: number;
  /** min is above max: the runner swaps them. */
  swapped: boolean;
  /** Unique numbers asked for beyond the range: the runner draws only this many. */
  uniqueCap?: number;
  /** More than `RANDOM_MAX_COUNT` asked for: the runner draws that many. */
  countCapped: boolean;
}

function numberOr(field: RandomFieldValue, fallback: number): number | undefined {
  if (field.kind === 'blank') return fallback;
  return field.kind === 'number' ? field.value : undefined;
}

function boundIssue(field: RandomFieldValue): RandomFieldIssue | undefined {
  if (field.kind === 'invalid') return 'format';
  if (field.kind === 'number' && !Number.isSafeInteger(field.value)) return 'unsafe';
  return undefined;
}

/**
 * What the editor can tell from a Random step's fields before it runs, by the runner's own rules
 * (`execRandom`): a decimal or a word is an error, a variable is only known at run time, an unsafe
 * integer fails the run, and a swapped range, a unique draw wider than the range and a count over
 * the cap are each quietly adjusted.
 */
export function randomFormFacts(config: Record<string, string>): RandomFormFacts {
  const minField = readRandomField(config.min);
  const maxField = readRandomField(config.max);
  const countField = readRandomField(config.count);
  const facts: RandomFormFacts = { swapped: false, countCapped: false };
  const minIssue = boundIssue(minField);
  const maxIssue = boundIssue(maxField);
  if (minIssue) facts.min = minIssue;
  if (maxIssue) facts.max = maxIssue;
  if (countField.kind === 'invalid') facts.count = 'format';
  else if (countField.kind === 'number' && countField.value < 1) facts.count = 'countRange';

  const count = facts.count ? undefined : numberOr(countField, RANDOM_DEFAULT_COUNT);
  if (count !== undefined) {
    facts.countValue = Math.min(count, RANDOM_MAX_COUNT);
    facts.countCapped = count > RANDOM_MAX_COUNT;
  }

  const min = minIssue ? undefined : numberOr(minField, RANDOM_DEFAULT_MIN);
  const max = maxIssue ? undefined : numberOr(maxField, RANDOM_DEFAULT_MAX);
  if (min === undefined || max === undefined) return facts;
  facts.swapped = min > max;
  const size = Math.abs(max - min) + 1;
  if (!Number.isSafeInteger(size)) {
    facts.max = 'unsafe';
    return facts;
  }
  if (config.unique === 'true' && facts.countValue !== undefined && facts.countValue > 1 && facts.countValue > size) {
    facts.uniqueCap = size;
  }
  return facts;
}
