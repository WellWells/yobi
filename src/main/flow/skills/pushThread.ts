import { PUSH_THREAD_TAG } from '../../../shared/builtin/prompts';
import { sealClosingTag } from '../../../shared/promptFencing';
import type { PushLine, PushThread, XPost } from './xPosts';
import { tallyPushes } from './pttPosts';

/*
 * What `x_thread` gives the analysis for an article with pushes (PTT): the article and the tally
 * of every push, then the pushes, written one per line. A busy thread is past what a web chat
 * takes in one message, so past the budget they are sampled: every boo that fits half of it (what
 * people object to is the point of reading pushes), then the opening and the latest pushes alike,
 * the gaps marked where they were.
 */

/** Everything the analysis reads, header, article and pushes, leaving the prompt plenty of room. */
export const PUSH_THREAD_MAX_CHARS = 14_000;
/** The article's share: the pushes are what the analysis is for. */
const ARTICLE_MAX_CHARS = 5_000;
/** What the header and the pushes' title line may take, kept out of the pushes' budget. */
const TITLE_RESERVE_CHARS = 200;
/** Tries at fitting the gap markers too: each try shrinks the lines' budget by what overflowed. */
const FIT_TRIES = 8;

const TAIPEI_OFFSET_MS = 8 * 3_600_000;

function chars(text: string): number {
  return Array.from(text).length;
}

function clip(text: string, max: number): string {
  const all = Array.from(text);
  return all.length > max ? `${all.slice(0, max).join('')}…` : text;
}

function taipei(ms: number): { year: number; stamp: string; day: string; time: string } {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  const two = (n: number): string => String(n).padStart(2, '0');
  return {
    year: d.getUTCFullYear(),
    stamp: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`,
    day: `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}`,
    time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`,
  };
}

/** `2026-10-15 21:47`, Taiwan time as PTT shows it; "" for no time. */
export function taipeiTime(ms: number): string {
  return ms ? taipei(ms).stamp : '';
}

/** One push as the analysis reads it: `<tag> id 10/15 21:50: text`, the year written only when it is not the article's. */
export function pushLineText(line: PushLine, articleYear: number): string {
  if (!line.at) return `${line.tag} ${line.user}: ${line.text}`;
  const when = taipei(line.at);
  const day = when.year === articleYear ? when.day : `${when.year}/${when.day}`;
  return `${line.tag} ${line.user} ${day} ${when.time}: ${line.text}`;
}

/**
 * Which pushes to write out, in order: all of them when they fit `maxCount` and `budget` characters;
 * otherwise every boo that fits half the budget (evenly spread when not all do), then the opening
 * and the latest pushes taken in turn until the budget is spent.
 */
export function samplePushes(lines: readonly PushLine[], rendered: readonly string[], maxCount: number, budget: number): number[] {
  const cost = rendered.map((text) => chars(text) + 1);
  const total = cost.reduce((sum, c) => sum + c, 0);
  if (lines.length <= maxCount && total <= budget) return lines.map((_, index) => index);
  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number): boolean => {
    if (chosen.size >= maxCount || used + cost[index] > budget) return false;
    chosen.add(index);
    used += cost[index];
    return true;
  };

  const boos = lines.flatMap((line, index) => (line.tag === '噓' ? [index] : []));
  let fit = 0;
  for (let spent = 0; fit < boos.length && spent + cost[boos[fit]] <= budget / 2 && fit < maxCount / 2; fit++) spent += cost[boos[fit]];
  for (let k = 0; k < fit; k++) take(boos[Math.floor((k * boos.length) / fit)]);

  let head = 0;
  let tail = lines.length - 1;
  let headOpen = true;
  let tailOpen = true;
  while ((headOpen || tailOpen) && head <= tail && chosen.size < maxCount) {
    if (headOpen) {
      if (chosen.has(head) || take(head)) head++;
      else headOpen = false;
    }
    if (tailOpen && head <= tail) {
      if (chosen.has(tail) || take(tail)) tail--;
      else tailOpen = false;
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

/** The chosen pushes, one per line, a marker wherever some were left out. */
export function writePushes(rendered: readonly string[], picked: readonly number[]): string {
  const out: string[] = [];
  let previous = -1;
  const gap = (count: number): void => {
    if (count > 0) out.push(`[… ${count} push${count === 1 ? '' : 'es'} not shown …]`);
  };
  for (const index of picked) {
    gap(index - previous - 1);
    out.push(rendered[index]);
    previous = index;
  }
  if (picked.length > 0) gap(rendered.length - previous - 1);
  return out.join('\n');
}

/**
 * The pushes written out within `room` characters, gap markers included: sampled, and sampled
 * again on a smaller budget while the markers push the text past it.
 */
export function fitPushes(lines: readonly PushLine[], rendered: readonly string[], maxCount: number, room: number): { picked: number[]; text: string } {
  let budget = room;
  let picked = samplePushes(lines, rendered, maxCount, budget);
  let text = writePushes(rendered, picked);
  for (let tries = 0; tries < FIT_TRIES && chars(text) > room; tries++) {
    budget = Math.max(0, budget - (chars(text) - room) - 1);
    picked = samplePushes(lines, rendered, maxCount, budget);
    text = writePushes(rendered, picked);
  }
  return { picked, text };
}

/**
 * `x_thread`'s output for an article with pushes: the fields an ordinary post's has (`shown` of
 * `replyCount` are the pushes written out of all of them), plus the board, the title and the
 * tally. At most `maxPushes` are written out ("0" = the article only).
 */
export function buildPushThreadEnvelope(focal: XPost, thread: PushThread, maxPushes: number, platform: string): string {
  const { lines } = thread;
  const tally = tallyPushes(lines);
  const posted = taipeiTime(focal.createdAt);
  const header = [
    `BOARD: ${thread.board}`,
    `TITLE: ${thread.title}`,
    `AUTHOR: ${focal.author}${focal.name ? ` (${focal.name})` : ''}`,
    ...(posted ? [`POSTED: ${posted}`] : []),
    `LINK: ${focal.link}`,
    `PUSH TALLY (every push): 推 ${tally.push} · 噓 ${tally.boo} · → ${tally.arrow} · ${lines.length} in all`,
  ].join('\n');
  const head = `${header}\n\nARTICLE:\n${clip(thread.body, ARTICLE_MAX_CHARS) || '(no text)'}`;
  const articleYear = focal.createdAt ? taipei(focal.createdAt).year : 0;
  const rendered = lines.map((line) => pushLineText(line, articleYear));
  const room = Math.max(0, PUSH_THREAD_MAX_CHARS - chars(head) - TITLE_RESERVE_CHARS);
  const { picked, text: pushText } = fitPushes(lines, rendered, maxPushes, room);
  const title = picked.length === lines.length
    ? `PUSHES (all ${lines.length}):`
    : `PUSHES (${picked.length} of ${lines.length} written out: the opening ones, the 噓 and the latest ones):`;
  const output = lines.length === 0 ? `${head}\n\nPUSHES: none` : `${head}\n\n${title}\n${pushText}`;
  return JSON.stringify({
    // Anyone can push: a push that closes the analysis's fence must not end it.
    output: sealClosingTag(PUSH_THREAD_TAG, output),
    subject: 'post',
    platform,
    text: thread.body,
    author: focal.author,
    name: focal.name,
    date: posted,
    link: focal.link,
    image: focal.image,
    replyCount: String(lines.length),
    shown: String(picked.length),
    replies: JSON.stringify(picked.map((index) => ({
      author: lines[index].user,
      name: '',
      date: taipeiTime(lines[index].at),
      text: `${lines[index].tag} ${lines[index].text}`,
      link: '',
      likes: '',
    }))),
    replyText: pushText,
    board: thread.board,
    title: thread.title,
    push: String(tally.push),
    boo: String(tally.boo),
    arrow: String(tally.arrow),
  });
}
