import { firstLine, flagged, hostOf, isHttpUrl, middle, num, outputPart, parts, t, unset, value, wholeRef } from './core';
import { describeRef, sourceOf } from './refs';
import { named } from './web';
import type { StepSummaryContext, Summarizer } from './types';

/** A path cut in the middle: the drive and the file name (or last folder) are what tell two apart. */
function path(raw: string, max = 40): string {
  return wholeRef(raw) ? raw : middle(raw, max);
}

/** A whole-field reference with what it is: "{{file}}（#5 分享的檔案）". */
function pathOrRef(ctx: StepSummaryContext, raw: string): string {
  const ref = wholeRef(raw);
  if (!ref) return path(raw);
  const described = describeRef(ref, ctx);
  return described.resolved ? t(ctx, 'flow.summary.withSource', { value: raw, source: described.text }) : raw;
}

const fileRead: Summarizer = (step, ctx) => {
  const file = value(step, 'path');
  if (!file) return unset(ctx, 'file_read', ['path'], outputPart(ctx, step));
  return named(step, ctx, t(ctx, 'flow.summary.file.read', { path: pathOrRef(ctx, file) }), outputPart(ctx, step));
};

const fileWrite: Summarizer = (step, ctx) => {
  const folder = value(step, 'folder') || t(ctx, 'flow.summary.file.outputFolder');
  const filename = value(step, 'filename') || t(ctx, 'flow.summary.file.autoName');
  const separator = /\\/.test(folder) ? '\\' : '/';
  const dest = middle(`${folder.replace(/[\\/]+$/, '')}${separator}${filename}`, 40);
  const content = value(step, 'content');
  if (!content) return unset(ctx, 'file_write', ['content'], dest);
  return named(step, ctx, t(ctx, 'flow.summary.file.write', { path: dest }), sourceOf(ctx, content) ?? firstLine(content, 32));
};

const fileList: Summarizer = (step, ctx) => {
  const directory = value(step, 'directory');
  if (!directory) return unset(ctx, 'file_list', ['directory'], outputPart(ctx, step));
  return named(step, ctx, t(ctx, 'flow.summary.file.list', { path: pathOrRef(ctx, directory) }), outputPart(ctx, step));
};

/** What a delete reaches: this run's own file, one fixed file, or every item of a loop. */
function deleteScope(ctx: StepSummaryContext, raw: string): string {
  const ref = wholeRef(raw);
  if (!ref) return t(ctx, 'flow.summary.delete.fixed');
  const described = describeRef(ref, ctx);
  if (described.kind === 'loop') return t(ctx, 'flow.summary.delete.each', { step: described.text });
  return t(ctx, 'flow.summary.delete.made');
}

const fileDelete: Summarizer = (step, ctx) => {
  const file = value(step, 'path');
  if (!file) return unset(ctx, 'file_delete', ['path']);
  return named(step, ctx, t(ctx, 'flow.summary.file.delete', { path: pathOrRef(ctx, file) }), deleteScope(ctx, file));
};

/** A download by its host and file name, the parts that tell two downloads apart. */
function downloadTarget(raw: string): string {
  if (raw.includes('{{')) return raw;
  const host = hostOf(raw);
  const name = raw.replace(/[?#].*$/, '').split('/').filter(Boolean).at(-1) ?? '';
  if (!host) return middle(raw, 40);
  return name && name !== host && !name.includes(host) ? middle(`${host}/…/${name}`, 40) : host;
}

const fileDownload: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  const folder = value(step, 'folder');
  const dest = folder ? t(ctx, 'flow.summary.file.to', { folder: middle(folder, 32) }) : t(ctx, 'flow.summary.file.toDownloads');
  if (!url) return unset(ctx, 'file_download', ['url'], dest);
  const cap = value(step, 'maxSizeMb');
  const summary = named(step, ctx, t(ctx, 'flow.summary.file.download', { url: downloadTarget(url) }), parts(
    dest, cap && cap !== '100' ? t(ctx, 'flow.summary.file.cap', { count: num(ctx, Number(cap)) }) : undefined,
  ));
  // The runner fetches https only.
  return !url.includes('{{') && !/^https:\/\//i.test(url)
    ? flagged(summary, 'error', t(ctx, isHttpUrl(url) ? 'flow.summary.file.httpsOnly' : 'flow.summary.issue.badUrl'))
    : summary;
};

export const FILE_SUMMARIES = {
  file_read: fileRead, file_write: fileWrite, file_list: fileList, file_delete: fileDelete, file_download: fileDownload,
} as const;
