import { clipboard } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { config, saveConfig, normalizeShareSettings } from './config';
import { CaptureTooTallError, captureMarkdownDocument } from './capture';
import { writeCaptureToClipboard, zipSingleFile } from './captureClipboard';
import type { ClipboardCopyOutcome } from './captureClipboard';
import { instanceHost, runWithExportPrompt } from './exportPrompt';
import type { ExportPanel } from './exportPrompt';
import { buildSafeFileNameFromTitle, buildSnapshotFileName, getOutputDir, getUniquePath } from './files';
import { sendLog, sendWebNotification } from './helpers';
import { getLangCache, t } from './i18n';
import { normalizeCaptureSettings, normalizeQuickExport } from './configNormalizers';
import { ShareError, createPaste, revokePaste } from './share/privatebin';
import { extractMarkdownTitle, splitLeadingTitle } from '../shared/markdownTitle';
import { stripConversationMarkers } from '../shared/conversationDoc';
import { captureBackgroundCss, paletteCardTheme } from '../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../shared/capturePalettes';
import type {
  CaptureExportChoice, MarkdownCaptureRequest, ShareExportChoice, ShareResultState,
} from '../shared/types';

type LangStrings = ReturnType<typeof getLangCache>;

/**
 * The panel can act on this, so it says how far over the limit the capture is and names a
 * width that should fit. The suggestion is an estimate; if it misses, the user simply gets
 * this notice again rather than losing anything.
 */
function tooTallNotice(err: CaptureTooTallError, strings: LangStrings): string {
  const over = t(strings, 'quickExport.tooTall.over', {
    format: err.format.toUpperCase(),
    limit: String(err.verdict.limit),
    height: String(err.verdict.encodedHeight),
  });
  // Only ever suggest what this panel can actually change: the width picker, or PDF.
  const hint = err.verdict.suggestedWidth === null
    ? t(strings, 'quickExport.tooTall.switch')
    : t(strings, 'quickExport.tooTall.widen', { width: String(err.verdict.suggestedWidth) });
  // CJK sentences already close with a full-width stop, which supplies its own spacing.
  return over + (/[。！？]$/.test(over) ? '' : ' ') + hint;
}

export function buildQuickExportRequest(markdown: string, choice: CaptureExportChoice): MarkdownCaptureRequest {
  const settings = config.captureSettings;
  const { title, body } = splitLeadingTitle(markdown);
  return {
    payload: {
      title,
      prompt: '',
      content: body,
      summary: '',
      provider: '',
      timestamp: '',
      turns: [{ prompt: '', response: body, provider: '', timestamp: '' }],
    },
    options: {
      mode: choice.action === 'save' ? 'save' : 'copy',
      format: choice.format,
      fileName: buildSafeFileNameFromTitle(choice.fileName) || buildSnapshotFileName(),
      showPrompt: false,
      showContent: true,
      showProvider: false,
      showTimestamp: false,
      showTokens: false,
      cardLayout: 'document',
      width: choice.width,
      margin: choice.margin,
      background: captureBackgroundCss(
        choice.palette,
        settings.backgroundStyle as CaptureBackgroundStyle,
        settings.direction as CaptureDirection,
      ),
      cardTheme: paletteCardTheme(choice.palette),
      pixelRatio: settings.pixelRatio,
      zip: choice.zip,
    },
  };
}

export function defaultExportName(markdown: string): string {
  const title = extractMarkdownTitle(markdown);
  return (title && buildSafeFileNameFromTitle(title)) || buildSnapshotFileName();
}

// SECURITY: the machine comments a conversation file carries must never leave the machine.
// Publishing is the one place where that leak is irreversible — strip before, not after.
export function buildQuickShareMarkdown(raw: string): string {
  return stripConversationMarkers(raw).trim();
}

function rememberCaptureChoice(choice: CaptureExportChoice): void {
  const capture = config.captureSettings;
  if (choice.width !== capture.width || choice.margin !== capture.margin || choice.palette !== capture.palette) {
    config.captureSettings = normalizeCaptureSettings({
      ...capture,
      width: choice.width,
      margin: choice.margin,
      palette: choice.palette,
    });
    saveConfig({ captureSettings: config.captureSettings });
  }
  if (choice.format === config.quickExport.format && choice.zip === config.quickExport.zip) return;
  config.quickExport = normalizeQuickExport({ ...config.quickExport, format: choice.format, zip: choice.zip });
  saveConfig({ quickExport: config.quickExport });
}

function rememberShareChoice(choice: ShareExportChoice): void {
  if (config.quickExport.format !== 'text') {
    config.quickExport = normalizeQuickExport({ ...config.quickExport, format: 'text' });
    saveConfig({ quickExport: config.quickExport });
  }
  const share = config.share;
  const consentedAt = share.consentedAt || new Date().toISOString();
  if (
    share.expire === choice.expire
    && share.burnAfterReading === choice.burnAfterReading
    && share.consentedAt === consentedAt
  ) return;
  config.share = normalizeShareSettings({
    ...share,
    expire: choice.expire,
    burnAfterReading: choice.burnAfterReading,
    consentedAt,
  });
  saveConfig({ share: config.share });
}

function shareErrorText(err: unknown, strings: LangStrings): string {
  if (err instanceof ShareError) {
    return [t(strings, `share.error.${err.code}`), err.detail].filter(Boolean).join(' ');
  }
  return err instanceof Error ? err.message : String(err);
}

function shareResultState(url: string, burned: boolean, strings: LangStrings): ShareResultState {
  return {
    url,
    revoked: false,
    burned,
    error: '',
    strings: {
      hint: t(strings, 'share.result.hint'),
      copied: t(strings, 'quickExport.panel.shareCopied'),
      open: t(strings, 'share.open'),
      burnBlocked: t(strings, 'share.open.burnBlocked'),
      revoke: t(strings, 'share.revoke'),
      revoked: t(strings, 'share.revoked'),
      done: t(strings, 'share.done'),
    },
  };
}

export async function performQuickShare(
  markdown: string,
  choice: ShareExportChoice,
  panel: ExportPanel,
  ctx: { instanceUrl: string; strings: LangStrings },
): Promise<boolean> {
  const body = buildQuickShareMarkdown(markdown);
  sendLog(
    `🔗 Quick export: publishing ${body.length} chars to ${instanceHost(ctx.instanceUrl)} `
    + `(expires: ${choice.expire})`,
  );
  const { url, deleteUrl } = await createPaste(ctx.instanceUrl, body, {
    expire: choice.expire,
    burnAfterReading: choice.burnAfterReading,
  });
  await clipboard.writeText(url);

  let state = shareResultState(url, choice.burnAfterReading, ctx.strings);
  while (true) {
    const action = await panel.showShareResult(state);
    if (action === 'open') {
      if (!state.revoked && !state.burned) await panel.openExternally(state.url);
      continue;
    }
    if (action !== 'revoke' || state.revoked) break;
    try {
      await revokePaste(ctx.instanceUrl, deleteUrl);
      await clipboard.writeText(markdown);
      sendLog('🔗 Quick export share revoked — clipboard restored');
      state = { ...state, revoked: true, error: '' };
    } catch (err) {
      state = { ...state, error: shareErrorText(err, ctx.strings) };
    }
  }
  return state.revoked;
}

export async function writeCaptureToDisk(
  buffer: Buffer,
  ext: string,
  fileStem: string,
  zip: boolean,
  panel: ExportPanel,
): Promise<string | null> {
  const outExt = zip ? 'zip' : ext;
  const defaultPath = await getUniquePath(path.join(await getOutputDir(), `${fileStem}.${outExt}`), '');
  const filePath = await panel.chooseSavePath(defaultPath, outExt);
  if (!filePath) return null;
  await fs.writeFile(filePath, zip ? zipSingleFile(buffer, `${fileStem}.${ext}`) : buffer);
  sendLog(`💾 Quick export saved: ${filePath}`);
  return filePath;
}

export async function runQuickExport(): Promise<void> {
  const strings = getLangCache();
  const title = t(strings, 'quickExport.notify.title');
  const markdown = (await clipboard.readText()).trim();
  if (!markdown) {
    sendWebNotification(title, t(strings, 'quickExport.notify.empty'), 'warning');
    return;
  }

  let sharing = false;
  let revoked = false;
  let savedPath: string | null = null;
  let copied: ClipboardCopyOutcome = 'ok';
  try {
    const choice = await runWithExportPrompt(
      {
        defaultName: defaultExportName(markdown),
        format: config.quickExport.format,
        zip: config.quickExport.zip,
        width: config.captureSettings.width,
        margin: config.captureSettings.margin,
      },
      async (chosen, panel) => {
        if (chosen.kind === 'share') {
          sharing = true;
          if (!config.share.consentedAt && !chosen.consentAccepted) throw new ShareError('noConsent');
          rememberShareChoice(chosen);
          revoked = await performQuickShare(markdown, chosen, panel, {
            instanceUrl: config.share.instanceUrl,
            strings,
          });
          return 'done';
        }
        const request = buildQuickExportRequest(markdown, chosen);
        sendLog(
          `🖼️ Quick export: rendering ${markdown.length} chars as ${chosen.format.toUpperCase()} `
          + `to ${chosen.action === 'save' ? 'a file' : 'the clipboard'}`,
        );
        let result;
        try {
          result = await captureMarkdownDocument(request);
        } catch (err) {
          // Recoverable: nothing has been written yet, so keep the panel open with the
          // measured numbers instead of tearing it down and making the user start over.
          if (!(err instanceof CaptureTooTallError)) throw err;
          sendLog(`🚫 Quick export: ${chosen.format.toUpperCase()} needs ${err.verdict.encodedHeight}px, limit is ${err.verdict.limit}px`);
          return { reopen: true, notice: tooTallNotice(err, strings) };
        }
        const fileStem = request.options.fileName as string;
        if (chosen.action === 'save') {
          savedPath = await writeCaptureToDisk(result.buffer, result.ext, fileStem, chosen.zip, panel);
          if (!savedPath) return 'reopen';
        } else {
          try {
            copied = await writeCaptureToClipboard(result.buffer, result.ext, fileStem, chosen.zip);
          } catch (err) {
            // The hotkey fires while the user is in another app, so a notification is the
            // one channel that may be silenced or unpermitted exactly when it is needed.
            // The panel is on screen right now — say it there, the way a too-tall capture does.
            const detail = err instanceof Error ? err.message : String(err);
            sendLog(`❌ Quick export: the clipboard refused the copy — ${detail}`);
            return { reopen: true, notice: t(strings, 'quickExport.notify.copyFailed', { error: detail }) };
          }
        }
        rememberCaptureChoice(chosen);
        return 'done';
      },
    );

    if (!choice) {
      sendLog('🚫 Quick export dismissed — clipboard untouched');
      return;
    }

    if (choice.kind === 'share') {
      sendWebNotification(
        title,
        t(strings, revoked ? 'quickExport.notify.shareRevoked' : 'quickExport.notify.shareCopied'),
        revoked ? 'warning' : 'success',
      );
      return;
    }

    if (choice.action === 'save') {
      if (!savedPath) {
        sendLog('🚫 Quick export save dismissed — nothing written');
        return;
      }
      sendWebNotification(
        title,
        t(strings, 'quickExport.notify.saved', { file: path.basename(savedPath) }),
        'success',
      );
      return;
    }

    // Three different true things, and saying "copied" for all of them would be the lie
    // that hid this whole class of bug: the picture may have been refused while the file
    // went through, or the clipboard may have declined to say what it took.
    const format = (choice.zip ? 'zip' : choice.format).toUpperCase();
    if (copied === 'ok') {
      sendWebNotification(title, t(strings, 'quickExport.notify.copied', { format }), 'success');
      return;
    }
    sendWebNotification(
      title,
      copied === 'fileOnly'
        ? t(strings, 'quickExport.notify.copiedFileOnly', { format })
        : t(strings, 'quickExport.notify.copiedUnverified', { format }),
      'warning',
    );
  } catch (err) {
    const message = shareErrorText(err, strings);
    sendLog(`❌ Quick export failed: ${message}`);
    sendWebNotification(
      title,
      t(strings, sharing ? 'quickExport.notify.shareFailed' : 'quickExport.notify.failed', { error: message }),
      'error',
    );
  }
}
