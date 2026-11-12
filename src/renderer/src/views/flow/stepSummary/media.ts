import { cut, flagged, isHttpUrl, lines, middle, num, outputPart, parts, shortUrl, someOf, t, unset, value, wholeRef } from './core';
import { describeRef, sourceOf } from './refs';
import { named, target } from './web';
import type { StepSummaryContext, Summarizer } from './types';

/** "YouTube dQw4w9WgXcQ", "bilibili BV1GJ411x7h7": a video link by its site and id. */
function videoName(raw: string): string {
  if (wholeRef(raw)) return raw.trim();
  const bv = /\b(BV[0-9A-Za-z]{10})\b/.exec(raw)?.[1];
  if (bv) return `bilibili ${bv}`;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^(www|m)\./, '');
    const id = host === 'youtu.be'
      ? url.pathname.slice(1)
      : host.endsWith('youtube.com') ? url.searchParams.get('v') ?? /\/(?:shorts|live|embed)\/([^/?]+)/.exec(url.pathname)?.[1] : null;
    if (id) return `YouTube ${id}`;
  } catch {
    // Not a URL: shown as written.
  }
  return shortUrl(raw);
}

/** A field that is one whole setting reads by the setting's name. */
function settingName(ctx: StepSummaryContext, raw: string): string | null {
  const ref = wholeRef(raw);
  return ref?.startsWith('var.') ? describeRef(ref, ctx).text : null;
}

function notVideo(raw: string): boolean {
  return !raw.includes('{{') && !isHttpUrl(raw);
}

const youtube: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  if (!url) return unset(ctx, 'youtube', ['url']);
  const fallback = value(step, 'fallbackProvider')
    ? t(ctx, 'flow.summary.youtube.fallback', { model: ctx.modelLabel?.(step) ?? 'Gemini' })
    : undefined;
  const summary = named(step, ctx, t(ctx, 'flow.summary.youtube.transcript', { video: videoName(url) }), fallback ?? outputPart(ctx, step));
  return notVideo(url) ? flagged(summary, 'error', t(ctx, 'flow.summary.issue.notVideo')) : summary;
};

/** Channel and account lines by their handles: `@name`, or a `UC…` channel id's first 8 characters. */
function handle(line: string): string {
  const at = /@([\w.-]+)/.exec(line)?.[1];
  if (at) return `@${at}`;
  const channel = /\/channel\/(UC[\w-]+)/.exec(line)?.[1];
  if (channel) return `${channel.slice(0, 8)}…`;
  return isHttpUrl(line) ? shortUrl(line, 24) : line;
}

function followList(ctx: StepSummaryContext, raw: string, noun: 'channels' | 'accounts'): string {
  const setting = settingName(ctx, raw);
  if (setting) return t(ctx, `flow.summary.follow.${noun}`, { name: setting });
  return someOf(ctx, lines(raw).map(handle), noun);
}

const youtubeSubs: Summarizer = (step, ctx) => {
  const channels = value(step, 'channels');
  if (!channels) return unset(ctx, 'youtube_subs', ['channels']);
  const per = Number(value(step, 'perChannel') || '3');
  const summary = named(step, ctx, followList(ctx, channels, 'channels'), parts(
    t(ctx, 'flow.summary.youtubeSubs.per', { count: num(ctx, per) }),
    step.config.skipShorts !== 'false' ? t(ctx, 'flow.summary.youtubeSubs.noShorts') : undefined,
  ));
  if (wholeRef(channels)) return summary;
  const bad = lines(channels).findIndex((line) => !line.startsWith('@') && !isHttpUrl(line) && !wholeRef(line));
  return bad >= 0 ? flagged(summary, 'error', t(ctx, 'flow.summary.youtubeSubs.badLine', { line: bad + 1 })) : summary;
};

const DESTINATIONS = new Set(['auto', 'telegram', 'line', 'local']);

function destination(ctx: StepSummaryContext, raw: string, folder: string): string {
  const where = DESTINATIONS.has(raw) ? raw : 'auto';
  if (where === 'local') return t(ctx, 'flow.summary.dest.local', { folder: folder ? middle(folder, 32) : t(ctx, 'flow.summary.dest.downloads') });
  return t(ctx, `flow.summary.dest.${where}`);
}

const youtubeInfo: Summarizer = (step, ctx) => {
  const input = value(step, 'input');
  if (!input) return unset(ctx, 'youtube_info', ['input']);
  const where = value(step, 'destination');
  const sizes = t(ctx, `flow.summary.youtubeInfo.sizes.${where === 'telegram' || where === 'local' ? where : 'auto'}`);
  return named(step, ctx, t(ctx, 'flow.summary.youtubeInfo.read', { input: cut(input, 32) }), parts(sourceOf(ctx, input), sizes));
};

const QUALITY_WORDS: Record<string, string> = { best: 'best', mp3: 'mp3', srt: 'srt' };

function qualityName(ctx: StepSummaryContext, raw: string): string | null {
  if (wholeRef(raw)) return raw;
  const word = QUALITY_WORDS[raw.toLowerCase()];
  if (word) return t(ctx, `flow.summary.quality.${word}`);
  const height = /^(\d{3,4})p?$/i.exec(raw)?.[1];
  return height ? `${height}p` : null;
}

const youtubeDownload: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  const quality = value(step, 'quality');
  const absent = [url ? '' : 'url', quality ? '' : 'quality'].filter(Boolean);
  if (absent.length > 0) return unset(ctx, 'youtube_download', absent);
  const label = qualityName(ctx, quality);
  const summary = named(step, ctx, `${label ?? quality} · ${videoName(url)}`, destination(ctx, value(step, 'destination'), value(step, 'folder')));
  if (notVideo(url)) return flagged(summary, 'error', t(ctx, 'flow.summary.issue.notVideo'));
  return label ? summary : flagged(summary, 'error', t(ctx, 'flow.summary.youtubeDownload.badQuality'));
};

const xPosts: Summarizer = (step, ctx) => {
  const accounts = value(step, 'accounts');
  if (!accounts) return unset(ctx, 'x_posts', ['accounts']);
  const per = Number(value(step, 'perAccount') || '5');
  const summary = named(step, ctx, followList(ctx, accounts, 'accounts'), t(ctx, 'flow.summary.xPosts.per', { count: num(ctx, per) }));
  if (wholeRef(accounts)) return summary;
  const bad = lines(accounts).findIndex((line) => !/^@?[A-Za-z0-9_]{1,15}$/.test(line) && !isHttpUrl(line) && !wholeRef(line));
  return bad >= 0 ? flagged(summary, 'error', t(ctx, 'flow.summary.xPosts.badLine', { line: bad + 1 })) : summary;
};

const xThread: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  if (!url) return unset(ctx, 'x_thread', ['url']);
  const replies = Number(value(step, 'maxReplies') || '20');
  const postOnly = replies === 0;
  const summary = named(
    step, ctx,
    t(ctx, postOnly ? 'flow.summary.xThread.post' : 'flow.summary.xThread.withReplies', { url: target(url) }),
    postOnly ? t(ctx, 'flow.summary.xThread.postOnly') : t(ctx, 'flow.summary.xThread.max', { count: num(ctx, replies) }),
  );
  return notVideo(url) ? flagged(summary, 'error', t(ctx, 'flow.summary.xThread.badUrl')) : summary;
};

const xTrends: Summarizer = (step, ctx) => {
  const count = Number(value(step, 'maxItems') || '20');
  const posts = Number(value(step, 'postsPerTrend') || '5');
  const what = posts === 0
    ? t(ctx, 'flow.summary.xTrends.namesOnly', { count: num(ctx, count) })
    : t(ctx, 'flow.summary.xTrends.top', { count: num(ctx, count), posts: num(ctx, posts) });
  const summary = named(step, ctx, what, t(ctx, 'flow.summary.xTrends.region'));
  return Number.isFinite(count) && count >= 1 ? summary : flagged(summary, 'error', t(ctx, 'flow.summary.xTrends.atLeastOne'));
};

const xMedia: Summarizer = (step, ctx) => {
  const input = value(step, 'input');
  if (!input) return unset(ctx, 'x_media', ['input']);
  return named(step, ctx, t(ctx, 'flow.summary.xMedia.get', { input: wholeRef(input) ? input : target(input, 32) }), destination(ctx, value(step, 'destination'), value(step, 'folder')));
};

export const MEDIA_SUMMARIES = {
  youtube, youtube_subs: youtubeSubs, youtube_info: youtubeInfo, youtube_download: youtubeDownload,
  x_posts: xPosts, x_thread: xThread, x_trends: xTrends, x_media: xMedia,
} as const;
