import * as fs from 'node:fs/promises';
import type { CaptureFormat, MarkdownCapturePayload, ShareExpire } from '../../../shared/types';
import { DEFAULT_CAPTURE_WIDTH, MAX_CAPTURE_WIDTH, MIN_CAPTURE_WIDTH, SHARE_EXPIRE_VALUES } from '../../../shared/types';
import { effectiveExpire } from '../../share/instanceExpires';
import {
  captureBackgroundCss,
  paletteCardTheme,
  CAPTURE_BACKGROUND_STYLES,
  DEFAULT_CAPTURE_BACKGROUND_STYLE,
  DEFAULT_CAPTURE_PALETTE,
} from '../../../shared/capturePalettes';
import type { CaptureBackgroundStyle } from '../../../shared/capturePalettes';
import { parseShareFormat, shareCaptureFormat } from '../../../shared/shareFormat';
import { stripConversationMarkers } from '../../../shared/conversationDoc';
import { getLangCache, t } from '../../i18n';
import { sendLog } from '../../helpers';
import type { FlowExecutorDeps } from '../types';
import { expandFilenameTokens } from './fileOps';

const DEFAULT_WIDTH = DEFAULT_CAPTURE_WIDTH;

const HEIGHT_LIMIT_MARKER = 'height exceeds limits';

export function isHeightLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.toLowerCase().includes(HEIGHT_LIMIT_MARKER);
}

export function resolveDocTitle(rawTitle: string, content: string, fallback: string): string {
  const explicit = rawTitle.trim();
  if (explicit) return explicit;
  for (const line of content.split(/\r?\n/)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const text = heading[1].replace(/[*_`~]/g, '').trim();
      if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    }
  }
  return fallback;
}

export function resolveBackgroundStyle(raw: string | undefined): CaptureBackgroundStyle {
  const value = (raw ?? '').trim().toLowerCase();
  return (CAPTURE_BACKGROUND_STYLES as readonly string[]).includes(value)
    ? (value as CaptureBackgroundStyle)
    : DEFAULT_CAPTURE_BACKGROUND_STYLE;
}

export function resolveDocWidth(raw: string | undefined): number {
  const parsed = Number((raw ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WIDTH;
  return Math.max(MIN_CAPTURE_WIDTH, Math.min(MAX_CAPTURE_WIDTH, Math.round(parsed)));
}

export function resolveShareExpire(raw: string | undefined, fallback: ShareExpire): ShareExpire {
  const value = (raw ?? '').trim().toLowerCase();
  return (SHARE_EXPIRE_VALUES as readonly string[]).includes(value) ? (value as ShareExpire) : fallback;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileSizeText(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    return formatBytes(stat.size);
  } catch {
    return '';
  }
}

interface ShareEnvelope {
  output: string;
  kind: 'file' | 'link';
  path: string;
  url: string;
  deleteUrl: string;
  format: string;
  requested: string;
  zipped: string;
  fellBack: string;
  expire: string;
  burn: string;
  summary: string;
}

function envelope(partial: Partial<ShareEnvelope> & { output: string; kind: 'file' | 'link' }): string {
  const full: ShareEnvelope = {
    path: '', url: '', deleteUrl: '', format: '', requested: '',
    zipped: '0', fellBack: '0', expire: '', burn: '0', summary: '',
    ...partial,
  };
  return JSON.stringify(full);
}

async function shareAsLink(
  content: string,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  requested: string,
): Promise<string> {
  if (!deps.createShareLink || !deps.getShareSettings) {
    throw new Error('share: link sharing requires createShareLink dependency');
  }
  const strings = getLangCache();
  const settings = deps.getShareSettings();
  if (!settings.consentedAt) {
    throw new Error(t(strings, 'flow.skill.share.error.noConsent'));
  }

  const expire = effectiveExpire(settings, resolveShareExpire(config.expire, settings.expire));
  const burn = config.burnAfterReading === 'true';
  const { url, deleteUrl } = await deps.createShareLink(content, { expire, burnAfterReading: burn });

  const summary = [
    t(strings, 'flow.skill.share.summary.link', { expire: t(strings, `share.expire.${expire}`) }),
    burn ? t(strings, 'flow.skill.share.summary.burn') : '',
  ].filter(Boolean).join(' — ');

  sendLog(`🔗 [Flow] share link created (expires: ${expire}${burn ? ', burn after reading' : ''})`);

  return envelope({
    output: url,
    kind: 'link',
    url,
    deleteUrl,
    format: 'text',
    requested,
    expire,
    burn: burn ? '1' : '0',
    summary,
  });
}

async function shareAsFile(
  content: string,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  requestedFormat: CaptureFormat,
  requested: string,
  zip: boolean,
): Promise<string> {
  if (!deps.captureMarkdown) throw new Error('share requires captureMarkdown dependency');
  const capture = deps.captureMarkdown;
  const strings = getLangCache();

  const palette = (config.palette ?? '').trim() || DEFAULT_CAPTURE_PALETTE;
  const backgroundStyle = resolveBackgroundStyle(config.backgroundStyle);
  const width = resolveDocWidth(config.width);
  const title = resolveDocTitle(
    config.title ?? '',
    content,
    t(strings, 'flow.skill.share.defaultTitle'),
  );
  const rawFileName = (config.filename ?? '').trim();

  const payload: MarkdownCapturePayload = {
    title,
    prompt: '',
    content,
    summary: '',
    provider: '',
    timestamp: new Date().toISOString(),
  };
  const options = {
    fileName: rawFileName ? expandFilenameTokens(rawFileName) : '',
    showPrompt: false,
    showContent: true,
    showProvider: false,
    showTimestamp: false,
    cardTheme: paletteCardTheme(palette),
    width,
    zip,
  };
  const background = captureBackgroundCss(palette, backgroundStyle);

  const render = (format: CaptureFormat): Promise<string> => capture(payload, format, background, options);

  let format = requestedFormat;
  let fellBack = false;
  let filePath: string;
  try {
    filePath = await render(format);
  } catch (err) {
    if (format === 'pdf' || !isHeightLimitError(err)) {
      throw new Error(`share: ${err instanceof Error ? err.message : String(err)}`);
    }
    sendLog(`⚠️ [Flow] share: ${format.toUpperCase()} exceeds the image height limit — re-rendering as PDF`);
    format = 'pdf';
    fellBack = true;
    filePath = await render(format);
  }

  const sizeText = await fileSizeText(filePath);
  const label = zip
    ? t(strings, 'flow.skill.share.summary.zipped', { format: format.toUpperCase() })
    : format.toUpperCase();
  const summary = [
    sizeText ? `${label} · ${sizeText}` : label,
    fellBack ? t(strings, 'flow.skill.share.summary.fellBack') : '',
  ].filter(Boolean).join(' — ');

  sendLog(`📄 [Flow] share generated: ${filePath} (${summary})`);

  return envelope({
    output: filePath,
    kind: 'file',
    path: filePath,
    format,
    requested,
    zipped: zip ? '1' : '0',
    fellBack: fellBack ? '1' : '0',
    summary,
  });
}

export async function execShare(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
): Promise<string> {
  const raw = config.content ?? '';
  if (!raw.trim()) throw new Error('share: content is empty');
  // SECURITY: conversation markers are machine state. Nothing handed to someone else —
  // a rendered card or an uploaded paste — may carry them.
  const content = stripConversationMarkers(raw);

  const requested = parseShareFormat(config.format);
  const zip = requested.zip || config.zip === 'true';

  if (requested.format === 'text') {
    return shareAsLink(content, config, deps, requested.format);
  }
  return shareAsFile(content, config, deps, shareCaptureFormat(requested.format), requested.format, zip);
}
