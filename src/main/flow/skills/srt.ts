import { decodeHtmlEntities } from '../../htmlEntities';
import { arr, num, obj, str } from './jsonPick';

/*
 * A video's subtitles as an .srt file, built by Yobi from the site's own timed captions (no
 * yt-dlp): YouTube's `json3` track, bilibili's subtitle file. The cues keep the site's timing; only
 * what would play badly is tidied — overlaps cut at the next cue, a line held on across two cues
 * kept once, empty cues dropped.
 */

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  /** One or more lines, `\n` between them. */
  text: string;
}

/** A cue the site gave no length runs this long at most (the next cue cuts it shorter). */
const UNTIMED_CUE_MS = 2_000;
/** A line repeated within this of the cue before is that line held on, not said again. */
const HOLD_GAP_MS = 100;

/**
 * YouTube's `json3` track: one event per cue (`tStartMs`, `dDurationMs`, `segs[].utf8`). Events
 * without words (the window set-up, an automatic track's line-feed events) give no cue.
 */
export function cuesFromJson3(file: unknown): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const event of arr(obj(file)?.events).map(obj)) {
    const segs = arr(event?.segs);
    if (!event || segs.length === 0) continue;
    const startMs = num(event.tStartMs);
    cues.push({ startMs, endMs: startMs + num(event.dDurationMs), text: segs.map((seg) => str(obj(seg)?.utf8)).join('') });
  }
  return cues;
}

/** bilibili's subtitle file: `body[]` of `{ from, to, content }`, in seconds. */
export function cuesFromBilibili(file: unknown): SubtitleCue[] {
  return arr(obj(file)?.body).map(obj).flatMap((line) => line
    ? [{ startMs: Math.round(num(line.from) * 1_000), endMs: Math.round(num(line.to) * 1_000), text: str(line.content) }]
    : []);
}

/** `01:02:03.456` or `02:03.456` (WebVTT's clock) in ms; NaN when it is neither. */
function vttTime(text: string): number {
  const found = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/.exec(text.trim());
  if (!found) return Number.NaN;
  const [, hours = '0', minutes, seconds, ms] = found;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1_000 + Number(ms);
}

/** A cue's payload as plain lines: tags (`<i>`, `<c.x>`, `<v Name>`, inline timestamps) dropped, entities read. */
function vttText(lines: readonly string[]): string {
  return lines.map((line) => decodeHtmlEntities(line.replace(/<[^>]*>/g, ''))).join('\n');
}

/**
 * A WebVTT file (Vimeo's caption tracks): one cue per block with a `start --> end` line (an
 * identifier line before it is skipped, cue settings after it ignored). `NOTE`, `STYLE` and
 * `REGION` blocks and the header give no cue; tags are dropped, so only the words remain.
 */
export function cuesFromVtt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.replace(/^\n+|\n+$/g, '').split('\n');
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0 || timing > 1) continue;
    const [start = '', rest = ''] = lines[timing].split('-->');
    const startMs = vttTime(start);
    const endMs = vttTime(rest.trim().split(/\s+/)[0] ?? '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    cues.push({ startMs, endMs, text: vttText(lines.slice(timing + 1)) });
  }
  return cues;
}

function cleanText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * The cues in time order, ready to write: text tidied (no blank lines, which would end an SRT
 * block), cues without words dropped, cues starting together shown as one, a line that the cue
 * before already shows dropped from the next one when they touch (a rolling automatic caption, a
 * held line split in two), and every cue ending by the time the next one starts.
 */
export function normalizeCues(raw: readonly SubtitleCue[]): SubtitleCue[] {
  const cues = raw
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))
    .map((cue) => ({ startMs: Math.max(0, Math.round(cue.startMs)), endMs: Math.round(cue.endMs), text: cleanText(cue.text) }))
    .filter((cue) => cue.text)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: SubtitleCue[] = [];
  for (const cue of cues) {
    const last = merged.at(-1);
    const shown = last ? last.text.split('\n') : [];
    const together = last !== undefined && cue.startMs === last.startMs;
    const touching = last !== undefined && cue.startMs <= last.endMs + HOLD_GAP_MS;
    const lines = together || touching ? cue.text.split('\n').filter((line) => !shown.includes(line)) : cue.text.split('\n');
    if (last && (together || lines.length === 0)) {
      if (lines.length > 0) last.text = [...shown, ...lines].join('\n');
      last.endMs = Math.max(last.endMs, cue.endMs);
      continue;
    }
    merged.push({ ...cue, text: lines.join('\n') });
  }
  return merged.map((cue, index) => {
    const next = merged[index + 1];
    const endMs = cue.endMs > cue.startMs ? cue.endMs : cue.startMs + UNTIMED_CUE_MS;
    return { ...cue, endMs: next && endMs > next.startMs ? next.startMs : endMs };
  });
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `01:02:03,456`: SRT's clock, hours never fewer than two digits. */
export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1_000) % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(total % 1_000, 3)}`;
}

/**
 * The .srt file's text: UTF-8 BOM and CRLF line ends, which Windows players need to read CJK
 * subtitles right; numbered blocks of the normalized cues. "" when no cue has words.
 */
export function buildSrt(raw: readonly SubtitleCue[]): string {
  const cues = normalizeCues(raw);
  if (cues.length === 0) return '';
  const blocks = cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
    ...cue.text.split('\n'),
  ].join('\r\n'));
  return `﻿${blocks.join('\r\n\r\n')}\r\n`;
}
