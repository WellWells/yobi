import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillInstance, SkillType } from '../../../../../shared/types';
import type { StepSummary, StepSummaryContext, StepSummaryState } from './types';

/**
 * A step's name: the one the user gave it, else its skill's name. A new step's label is the skill
 * name in the language it was added in, so a label equal to it counts as no name.
 */
export function stepDisplayName(step: SkillInstance, translate: (key: string) => string): string {
  const skill = translate(`flow.skill.${step.type}`);
  const label = step.label.trim();
  return label || skill;
}

/** Whether the user named the step (its label is not just the skill's name). */
export function isNamed(step: SkillInstance, translate: (key: string) => string): boolean {
  const label = step.label.trim();
  return label !== '' && label !== translate(`flow.skill.${step.type}`);
}

/** A language-file string, filled; named `t` so the key gates see every literal key. */
export function t(ctx: StepSummaryContext, key: string, vars?: Readonly<Record<string, string | number>>): string {
  const text = ctx.t(key);
  return vars ? fillTemplate(text, vars) : text;
}

/** Joins the parts of a second line; empty parts drop out, and no parts is no line. */
export function parts(...items: Array<string | undefined | false | null>): string | undefined {
  const kept = items.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return kept.length > 0 ? kept.join(' · ') : undefined;
}

export function cut(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('').trimEnd()}…`;
}

/** Cut in the middle: the start and the end (a host and a file name) are what tell targets apart. */
export function middle(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const keep = Math.max(2, max - 1);
  const head = Math.ceil(keep / 2);
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (keep - head)).join('')}`;
}

export function value(step: SkillInstance, key: string): string {
  return (step.config[key] ?? '').trim();
}

export function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function firstLine(text: string, max = 48): string {
  return cut(lines(text)[0] ?? '', max);
}

const WHOLE_REF = /^\{\{\s*([^{}]+?)\s*\}\}$/;

/** The reference a field holds when it is nothing but one `{{…}}`. */
export function wholeRef(text: string): string | null {
  return WHOLE_REF.exec(text.trim())?.[1] ?? null;
}

/** A list in the interface's separator ("A、B" / "A, B"). */
export function list(ctx: StepSummaryContext, items: readonly string[]): string {
  return items.join(t(ctx, 'flow.summary.sep'));
}

/** The first `shown` items and how many there are in all: "A、B 等 5 個頻道". */
export function someOf(ctx: StepSummaryContext, items: readonly string[], noun: string, shown = 2): string {
  if (items.length <= shown) return list(ctx, items);
  return t(ctx, `flow.summary.more.${noun}`, { items: list(ctx, items.slice(0, shown)), count: items.length, more: items.length - shown });
}

/** `https://www.example.com/news/` → `example.com/news`, cut in the middle. */
export function shortUrl(raw: string, max = 40): string {
  const bare = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  return middle(bare, max);
}

export function hostOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

export function isHttpUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim());
}

/** A number in the interface language's digits and grouping. */
export function num(ctx: StepSummaryContext, n: number, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(ctx.locale ?? 'en-US', { maximumFractionDigits: fractionDigits }).format(n);
  } catch {
    return String(n);
  }
}

/** "尚未設定：網址、主旨", by the names of the fields that are empty. */
export function unset(ctx: StepSummaryContext, type: SkillType, fields: readonly string[], secondary?: string): StepSummary {
  const names = fields.map((field) => t(ctx, `flow.summary.field.${type}.${field}`));
  return { primary: t(ctx, 'flow.summary.unset', { fields: list(ctx, names) }), secondary, state: 'unset' };
}

/** The required fields among `keys` that are blank. */
export function missing(step: SkillInstance, keys: readonly string[]): string[] {
  return keys.filter((key) => value(step, key) === '');
}

export function ok(primary: string, secondary?: string, extra: Partial<StepSummary> = {}): StepSummary {
  return { primary, secondary, state: 'ok', ...extra };
}

export function flagged(summary: StepSummary, state: Exclude<StepSummaryState, 'ok' | 'unset'>, issue: string): StepSummary {
  return { ...summary, state, issue };
}

/** `{{key}}` as the step's output reads in other fields. */
export function outputToken(step: SkillInstance): string | undefined {
  return step.outputKey ? `{{${step.outputKey}}}` : undefined;
}

export function outputPart(ctx: StepSummaryContext, step: SkillInstance): string | undefined {
  const token = outputToken(step);
  return token ? t(ctx, 'flow.summary.output', { key: token }) : undefined;
}
