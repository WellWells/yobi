import { parseLlmExportFormats } from '../../../../../shared/fileOutputStep';
import { isByokTargetUrl } from '../../../../../shared/types';
import { isTranslateLanguage, languageDisplayName } from '../../../../../shared/translateLanguages';
import { parseJsonStringArray, splitUrlListText } from '../../../../../shared/urlRows';
import {
  cut, firstLine, flagged, isHttpUrl, isNamed, lines, list, missing, num, ok, outputPart, parts, t, unset, value, wholeRef,
} from './core';
import { describeRef, scopeAt, sourceOf } from './refs';
import type { StepSummary, StepSummaryContext, Summarizer } from './types';

const ROLE_OPENING = /^(你是|您是|你现在是|你現在是|you are|you're|act as)/i;
const SENTENCE_END = /(?<=[。！？!?]|\.\s)/;

function stripMarkdown(line: string): string {
  return line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, '').replace(/[*_`~]+/g, '').trim();
}

/** A line that says nothing on its own: only references, punctuation, or an `ALL CAPS:` section head. */
function isFiller(line: string): boolean {
  if (/^[A-Z][A-Z0-9 _/-]*:/.test(line)) return true;
  return line.replace(/\{\{[^{}]*\}\}/g, '').replace(/[\p{P}\p{S}\s]/gu, '') === '';
}

/**
 * The prompt's task in one line: its first line that says something, past a "You are…" role
 * sentence when more follows, without trailing references or a colon. Prompts open with the same
 * role line often enough that it cannot tell two AI steps apart.
 */
export function taskSentence(prompt: string, max = 40): string {
  let fallback = '';
  for (const raw of lines(prompt)) {
    let line = stripMarkdown(raw);
    if (!line || isFiller(line)) continue;
    if (ROLE_OPENING.test(line)) {
      const rest = line.split(SENTENCE_END).slice(1).join('').trim();
      if (!rest || isFiller(rest)) {
        fallback ||= line;
        continue;
      }
      line = rest;
    }
    return cut(line.replace(/(\s*\{\{[^{}]*\}\})+\s*$/, '').replace(/[:：]\s*$/, '').trim(), max);
  }
  return cut(fallback, max);
}

const llm: Summarizer = (step, ctx) => {
  const prompt = value(step, 'prompt');
  const provider = value(step, 'provider');
  const model = ctx.modelLabel?.(step);
  const formats = parseLlmExportFormats(step.config.exportFormat).map((format) => format.toUpperCase());
  const exported = formats.length > 0 ? t(ctx, 'flow.summary.llm.export', { formats: list(ctx, formats) }) : undefined;
  const source = sourceOf(ctx, prompt, value(step, 'attachments'));
  if (!prompt) return unset(ctx, 'llm', ['prompt'], parts(source, model, exported));
  const task = taskSentence(prompt);
  const summary = isNamed(step, ctx.t)
    ? ok(step.label.trim(), parts(task, source, model, exported))
    : ok(task, parts(source, model, exported));
  // A BYOK key this computer no longer has: the picker shows nothing, the run fails.
  if (ctx.modelLabel && provider && isByokTargetUrl(provider) && !model) return flagged(summary, 'error', t(ctx, 'flow.summary.llm.keyMissing'));
  return summary;
};

const RESEARCH_DEPTHS = ['quick', 'standard', 'deep'] as const;

/** A JSON array of URLs or a free-text list, as the steps that take several pages read it. */
export function urlList(raw: string): string[] {
  if (raw.startsWith('[')) return (parseJsonStringArray(raw) ?? [raw]).map((url) => url.trim()).filter(Boolean);
  return splitUrlListText(raw);
}

const research: Summarizer = (step, ctx) => {
  const query = value(step, 'query');
  const urls = urlList(value(step, 'urls'));
  const depth = RESEARCH_DEPTHS.find((item) => item === value(step, 'depth')) ?? 'standard';
  const pages = urls.length === 0
    ? t(ctx, 'flow.summary.research.web')
    : urls.length === 1 && wholeRef(urls[0])
      ? sourceOf(ctx, urls[0])
      : t(ctx, 'flow.summary.research.pages', { count: urls.length });
  const how = parts(t(ctx, `flow.summary.research.depth.${depth}`), pages);
  if (!query) return unset(ctx, 'research', ['query'], urls.length > 0 ? pages : undefined);
  const ref = wholeRef(query);
  const asked = ref
    ? t(ctx, 'flow.summary.research.ref', { source: describeRef(ref, ctx).text })
    : t(ctx, 'flow.summary.research.query', { query: cut(query.replace(/\s+/g, ' '), 40) });
  const summary = isNamed(step, ctx.t) ? ok(step.label.trim(), parts(asked, how)) : ok(asked, how);
  const bad = urls.findIndex((url) => !wholeRef(url) && !isHttpUrl(url));
  return bad >= 0 ? flagged(summary, 'error', t(ctx, 'flow.summary.issue.lineNotUrl', { line: bad + 1 })) : summary;
};

function languageName(ctx: StepSummaryContext, tag: string): string {
  if (isTranslateLanguage(tag)) return languageDisplayName(tag, ctx.locale ?? 'en-US');
  const ref = wholeRef(tag);
  return ref ? describeRef(ref, ctx).text : tag;
}

const translate: Summarizer = (step, ctx) => {
  const text = value(step, 'text');
  const to = value(step, 'to');
  const from = value(step, 'from');
  const source = sourceOf(ctx, text);
  const absent = missing(step, ['to', 'text']);
  if (absent.length > 0) return unset(ctx, 'translate', absent, source);
  const what = from
    ? t(ctx, 'flow.summary.translate.fromTo', { from: languageName(ctx, from), to: languageName(ctx, to) })
    : t(ctx, 'flow.summary.translate.to', { to: languageName(ctx, to) });
  return isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, source)) : ok(what, source);
};

const LEADING_COMMENT = /^\s*\/\/\s*(.+)$/;

/** A program's own name for itself: its first line when that is a `//` comment. */
export function codeComment(code: string): string | null {
  const first = lines(code)[0];
  const comment = first ? LEADING_COMMENT.exec(first)?.[1]?.trim() : undefined;
  return comment ? cut(comment, 48) : null;
}

/** "8 行程式碼": what a program is, without a character of it (code holds passwords). */
export function codeSize(ctx: StepSummaryContext, code: string): string {
  return t(ctx, 'flow.summary.code.lines', { count: lines(code).length });
}

/** Outputs the code reads: bare names of in-scope outputs, `vars["…"]`, and `{{…}}`. */
function codeSources(ctx: StepSummaryContext, code: string): string | undefined {
  const scope = scopeAt(ctx.steps, ctx.index);
  const keys = new Set<string>();
  for (const match of code.matchAll(/vars\[\s*['"]([^'"]+)['"]\s*\]/g)) keys.add(match[1].split('.')[0]);
  for (const match of code.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) if (scope.outputs.has(match[0])) keys.add(match[0]);
  const named = [...keys].filter((key) => scope.outputs.has(key)).map((key) => `{{${key}}}`);
  return sourceOf(ctx, named.join(' '), code);
}

const js: Summarizer = (step, ctx) => {
  const code = step.config.code ?? '';
  if (!code.trim()) return unset(ctx, 'js', ['code']);
  const what = codeComment(code) ?? codeSize(ctx, code);
  const source = codeSources(ctx, code);
  const summary = isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, source)) : ok(what, parts(source, outputPart(ctx, step)));
  // Outside text pasted straight into code breaks on a quote, or runs as code.
  const pasted = /\{\{\s*([^{}]+?)\s*\}\}/.exec(code)?.[0];
  return pasted ? flagged(summary, 'warning', t(ctx, 'flow.summary.js.refInCode', { ref: pasted })) : summary;
};

const text: Summarizer = (step, ctx) => {
  const body = step.config.text ?? '';
  if (!body.trim()) return unset(ctx, 'text', ['text'], outputPart(ctx, step));
  const count = lines(body).length;
  const size = count > 1 ? t(ctx, 'flow.summary.text.lines', { count }) : undefined;
  const first = firstLine(body, 40);
  if (isNamed(step, ctx.t)) return ok(step.label.trim(), parts(first, outputPart(ctx, step)));
  return ok(first, parts(outputPart(ctx, step), size, sourceOf(ctx, body)));
};

function bound(ctx: StepSummaryContext, raw: string): string {
  const ref = wholeRef(raw);
  if (ref) return describeRef(ref, ctx).text;
  const n = Number(raw);
  return Number.isFinite(n) ? num(ctx, n) : raw;
}

const random: Summarizer = (step, ctx) => {
  const absent = missing(step, ['min', 'max']);
  if (absent.length > 0) return unset(ctx, 'random', absent, outputPart(ctx, step));
  const min = value(step, 'min');
  const max = value(step, 'max');
  const count = Number(value(step, 'count') || '1');
  const unique = step.config.unique === 'true' && count > 1;
  const what = t(ctx, unique ? 'flow.summary.random.pickUnique' : 'flow.summary.random.pick', {
    min: bound(ctx, min), max: bound(ctx, max), count: Number.isFinite(count) ? num(ctx, count) : value(step, 'count'),
  });
  const shape = count > 1 ? t(ctx, 'flow.summary.random.list') : undefined;
  const summary: StepSummary = isNamed(step, ctx.t)
    ? ok(step.label.trim(), what)
    : ok(what, parts(outputPart(ctx, step), shape));
  const low = Number(min);
  const high = Number(max);
  if (!wholeRef(min) && !wholeRef(max)) {
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || !Number.isSafeInteger(high - low)) {
      return flagged(summary, 'error', t(ctx, 'flow.summary.random.range'));
    }
    const size = high - low + 1;
    if (unique && count > size) return flagged(summary, 'warning', t(ctx, 'flow.summary.random.tooFew', { count: size }));
  }
  return summary;
};

export const AI_SUMMARIES = { llm, research, translate, js, text, random } as const;
