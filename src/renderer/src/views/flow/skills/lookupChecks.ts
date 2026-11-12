/**
 * Field checks the lookup step forms run while typing. Each mirrors what the executor will do with
 * the value, and a field holding a `{{variable}}` is never judged: its value is only known at run
 * time.
 */

import { fillTemplate } from '../../../../../shared/fillTemplate';
import { MAX_HISTORY_YEARS, readForecastWindow, readHistoryWindow } from '../../../../../shared/lookupDateWindows';

const HAS_VAR = /\{\{[^}]*\}\}/;

/** The fields as checked: a field holding a variable is left out (treated as blank). */
function knownOnly(config: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const known = { ...config };
  for (const key of keys) if (HAS_VAR.test(known[key] ?? '')) known[key] = '';
  return known;
}

export interface FieldRefusal {
  /** The field the message goes under. */
  field: 'period' | 'date' | 'hours';
  /** The executor's own error key (`flow.error.*`), filled with `value` (and `years`). */
  key: string;
  value: string;
}

/** The refusal under `field`, in the words the run would use; undefined for any other field. */
export function refusalText(refusal: FieldRefusal | null, field: FieldRefusal['field'], t: (key: string) => string): string | undefined {
  if (!refusal || refusal.field !== field) return undefined;
  return fillTemplate(t(refusal.key), { value: refusal.value, years: String(MAX_HISTORY_YEARS) });
}

/**
 * What a stock or forex run would refuse in `period`/`date`, by the run's own parser, as of now.
 * A span ending before the 10-year limit is the period's problem even though the run names the date.
 */
export function historyRefusal(config: Record<string, string>, now: Date = new Date()): FieldRefusal | null {
  const known = knownOnly(config, ['period', 'date']);
  const window = readHistoryWindow(known, now);
  if (window.ok) return null;
  const inDate = window.reason === 'date' && window.value === (known.date ?? '').trim();
  return {
    field: inDate ? 'date' : 'period',
    key: window.reason === 'period' ? 'flow.error.marketPeriod' : 'flow.error.marketDate',
    value: window.value,
  };
}

/**
 * What a weather run would refuse in `date`/`hours`. Only the spelling: whether the days are in
 * the source's range depends on the day the step runs, so that stays a run-time error.
 */
export function forecastRefusal(config: Record<string, string>, now: Date = new Date()): FieldRefusal | null {
  const window = readForecastWindow(knownOnly(config, ['date', 'hours']), now);
  if (window.ok || window.reason === 'range') return null;
  return window.reason === 'hours'
    ? { field: 'hours', key: 'flow.error.weatherHours', value: window.value }
    : { field: 'date', key: 'flow.error.weatherDate', value: window.value };
}

/** A currency is three letters (the executor upper-cases it); blank is the "required" case, not this. */
export function badCurrencyCode(raw: string | undefined): boolean {
  const text = (raw ?? '').trim();
  return text !== '' && !HAS_VAR.test(text) && !/^[A-Za-z]{3}$/.test(text);
}

/** The amount is read with `Number()`: "1,000" or "ten" makes the step report no rate. */
export function badForexAmount(raw: string | undefined): boolean {
  const text = (raw ?? '').trim();
  return text !== '' && !HAS_VAR.test(text) && !Number.isFinite(Number(text));
}

/** Both sides name the same currency: the step then answers 1 without asking any source. */
export function sameCurrency(base: string | undefined, target: string | undefined): boolean {
  const a = (base ?? '').trim();
  const b = (target ?? '').trim();
  return a !== '' && !HAS_VAR.test(a) && a.toUpperCase() === b.toUpperCase();
}
