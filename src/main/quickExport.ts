import { clipboard } from 'electron';
import { config, saveConfig, normalizeShareSettings } from './config';
import { captureMarkdownDocument } from './capture';
import { writeCaptureToClipboard } from './captureClipboard';
import { instanceHost, runWithExportPrompt } from './exportPrompt';
import type { ExportPanel } from './exportPrompt';
import { buildSafeFileNameFromTitle, buildSnapshotFileName } from './files';
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
      mode: 'copy',
      format: choice.format,
      fileName: buildSafeFileNameFromTitle(choice.fileName) || buildSnapshotFileName(),
      showPrompt: false,
      showContent: true,
      showProvider: false,
      showTimestamp: false,
      showTokens: false,
      cardLayout: 'document',
      width: choice.width,
      background: captureBackgroundCss(
        settings.palette,
        settings.backgroundStyle as CaptureBackgroundStyle,
        settings.direction as CaptureDirection,
      ),
      cardTheme: paletteCardTheme(settings.palette),
      pixelRatio: settings.pixelRatio,
      zip: choice.zip,
    },
  };
}

export function defaultExportName(markdown: string): string {
  const title = extractMarkdownTitle(markdown);
  return (title && buildSafeFileNameFromTitle(title)) || buildSnapshotFileName();
}

/*
 * Exported for the test suite. The machine comments a conversation file carries
 * (`yobi:thread` / `yobi:turn`) must never leave the machine — publishing is the one
 * place where a leak is irreversible.
 */
export function buildQuickShareMarkdown(raw: string): string {
  return stripConversationMarkers(raw).trim();
}

function rememberCaptureChoice(choice: CaptureExportChoice): void {
  /*
   * Width is deliberately stored in captureSettings rather than alongside the
   * panel's own format/zip memory: it is the same setting the export dialog
   * shows, so picking a size in either place moves both.
   */
  if (choice.width !== config.captureSettings.width) {
    config.captureSettings = normalizeCaptureSettings({ ...config.captureSettings, width: choice.width });
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
  /* Expire and burn live in the same config the chat dialog edits, so both entry points move together. */
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

function shareResultState(url: string, strings: LangStrings): ShareResultState {
  return {
    url,
    revoked: false,
    error: '',
    strings: {
      hint: t(strings, 'share.result.hint'),
      copied: t(strings, 'quickExport.panel.shareCopied'),
      revoke: t(strings, 'share.revoke'),
      revoked: t(strings, 'share.revoked'),
      done: t(strings, 'share.done'),
    },
  };
}

/*
 * Exported for the test suite, and deliberately free of config reads: everything it needs
 * is passed in, so the revoke loop can be driven with a stub panel. Returns whether the
 * paste ended up revoked.
 */
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
  clipboard.writeText(url);

  let state = shareResultState(url, ctx.strings);
  while (true) {
    const action = await panel.showShareResult(state);
    if (action !== 'revoke' || state.revoked) break;
    try {
      await revokePaste(ctx.instanceUrl, deleteUrl);
      /* The link is dead now — leaving it on the clipboard is worse than putting back what was there. */
      clipboard.writeText(markdown);
      sendLog('🔗 Quick export share revoked — clipboard restored');
      state = { ...state, revoked: true, error: '' };
    } catch (err) {
      state = { ...state, error: shareErrorText(err, ctx.strings) };
    }
  }
  return state.revoked;
}

export async function runQuickExport(): Promise<void> {
  const strings = getLangCache();
  const title = t(strings, 'quickExport.notify.title');
  const markdown = clipboard.readText().trim();
  if (!markdown) {
    sendWebNotification(title, t(strings, 'quickExport.notify.empty'), 'warning');
    return;
  }

  let sharing = false;
  let revoked = false;
  try {
    const choice = await runWithExportPrompt(
      {
        defaultName: defaultExportName(markdown),
        format: config.quickExport.format,
        zip: config.quickExport.zip,
        width: config.captureSettings.width,
      },
      async (chosen, panel) => {
        if (chosen.kind === 'share') {
          sharing = true;
          /* The panel talks to no IPC, so the consent gate the share handler enforces is enforced here. */
          if (!config.share.consentedAt && !chosen.consentAccepted) throw new ShareError('noConsent');
          rememberShareChoice(chosen);
          revoked = await performQuickShare(markdown, chosen, panel, {
            instanceUrl: config.share.instanceUrl,
            strings,
          });
          return;
        }
        const request = buildQuickExportRequest(markdown, chosen);
        sendLog(`🖼️ Clipboard capture: rendering ${markdown.length} chars as ${chosen.format.toUpperCase()}`);
        const result = await captureMarkdownDocument(request);
        await writeCaptureToClipboard(
          result.buffer,
          result.ext,
          request.options.fileName as string,
          chosen.zip,
        );
        rememberCaptureChoice(chosen);
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

    sendWebNotification(
      title,
      t(strings, 'quickExport.notify.copied', { format: (choice.zip ? 'zip' : choice.format).toUpperCase() }),
      'success',
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
