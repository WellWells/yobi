import { formatMegabytes } from './ytdl';
import type { DownloadKind } from './ytdl';
import { fillTemplate as fill } from './fillTemplate';

/**
 * Where a long flow step is, as data: the desktop chat draws a live bar from it, a Telegram status
 * message a text one. `youtube_download` reports it, and `youtube_info` while a slow video read
 * (`reading`) is still going.
 */
export type StepProgressPhase = 'reading' | 'starting' | 'downloading' | 'processing' | 'sending';

export interface StepProgress {
  phase: StepProgressPhase;
  /** What is being fetched, e.g. the quality label "720p60"; for `reading`, the site's name. */
  label: string;
  /** 0–99 while downloading; null when no total is known. */
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  /** What the download hands over; absent = a video. An MP3 is converted and sent as sound. */
  kind?: DownloadKind;
}

export interface StepProgressText {
  title: string;
  /** "35 MB / 81 MB · 3.2 MB/s · about 15 s left", or '' when there is nothing to count. */
  detail: string;
}


export function formatEta(seconds: number, t: (key: string) => string): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return fill(t('ytdl.progress.seconds'), { n: String(s) });
  const m = Math.floor(s / 60);
  if (m < 60) return fill(t('ytdl.progress.minutes'), { m: String(m), s: String(s % 60) });
  return fill(t('ytdl.progress.hours'), { h: String(Math.floor(m / 60)), m: String(m % 60) });
}

/** The words for a progress report; `t` returns the raw template for a key (main or renderer). */
export function stepProgressText(p: StepProgress, t: (key: string) => string): StepProgressText {
  if (p.phase === 'reading') return { title: fill(t('ytdl.progress.reading'), { site: p.label }), detail: '' };
  if (p.phase === 'starting') return { title: fill(t('ytdl.progress.start'), { quality: p.label }), detail: '' };
  const audio = p.kind === 'audio';
  if (p.phase === 'processing') return { title: t(audio ? 'ytdl.progress.converting' : 'ytdl.progress.processing'), detail: '' };
  if (p.phase === 'sending') {
    const size = formatMegabytes(p.totalBytes ?? p.downloadedBytes);
    return { title: fill(t(audio ? 'ytdl.progress.sendingAudio' : 'ytdl.progress.sending'), { size }), detail: '' };
  }
  const parts = [
    p.totalBytes !== null
      ? fill(t('ytdl.progress.amount'), { done: formatMegabytes(p.downloadedBytes), total: formatMegabytes(p.totalBytes) })
      : formatMegabytes(p.downloadedBytes),
  ];
  if (p.bytesPerSecond !== null && p.bytesPerSecond > 0) {
    parts.push(fill(t('ytdl.progress.speed'), { speed: formatMegabytes(p.bytesPerSecond) }));
  }
  if (p.etaSeconds !== null) parts.push(fill(t('ytdl.progress.eta'), { time: formatEta(p.etaSeconds, t) }));
  return { title: fill(t('ytdl.progress.downloading'), { quality: p.label }), detail: parts.join(' · ') };
}

const BAR_CELLS = 12;

/** `█████░░░░░░░ 45%` — block elements are one width in Telegram's fonts on every platform. */
export function textProgressBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_CELLS);
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_CELLS - filled)} ${Math.floor(clamped)}%`;
}

/** The whole Telegram status message: title, a text bar when there is a percent, the counts. */
export function stepProgressMessage(p: StepProgress, t: (key: string) => string): string {
  const { title, detail } = stepProgressText(p, t);
  const lines = [title];
  if (p.phase === 'downloading' && p.percent !== null) lines.push(textProgressBar(p.percent));
  if (detail) lines.push(detail);
  return lines.join('\n');
}
