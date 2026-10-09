import { registerHotkey } from './hotkey';
import { config } from './config';
import { getProviderLabel } from './providers';
import { sendLog, sendWebNotification, createTaskId } from './helpers';
import {
  captureSelectedText,
  checkMacosAccessibility,
  clipboardFingerprint,
  isClipboardCaptureInFlight,
  promptMacosAccessibility,
} from './clipboard';
import { getLangCache, t } from './i18n';
import { resolveUrlPrompt } from './urlParser';
import { runQuickExport } from './quickExport';
import type { QueueManager } from './queueManager';
import type { QuickExportSettings } from '../shared/types';
import { compactPreview } from '../shared/textBudget';

export interface HotkeyDeps {
  queue: QueueManager;
}

let _accessibilityPrompted = false;

export function bindHotkey(deps: HotkeyDeps): boolean {
  const { queue } = deps;
  const accelerator = mainAccelerator(config);
  const ok = registerHotkey('main', accelerator, async () => {
    if (process.platform === 'darwin' && !checkMacosAccessibility()) {
      const langData = getLangCache();
      const title = t(langData, 'hotkey.notify.accessibility.title');
      const errorMsg = t(langData, 'hotkey.error.accessibility');
      sendLog(`❌ ${title} — ${errorMsg}`);
      sendWebNotification(title, errorMsg, 'warning');
      if (!_accessibilityPrompted) {
        _accessibilityPrompted = true;
        promptMacosAccessibility();
      }
      return;
    }

    // Asked before the call so the log says which of the two happened: a capture is already
    // polling (the press is dropped on purpose), or there really was nothing selected.
    if (isClipboardCaptureInFlight()) {
      sendLog('⏳ Still capturing the previous selection — ignoring this press');
      return;
    }

    const rawText = await captureSelectedText();
    if (!rawText) {
      sendLog('⚠️  Clipboard is empty — nothing to send');
      return;
    }
    // Taken before the URL fetch below, which can take seconds: a copy made from here on is the
    // user's, and the answer must not land on top of it.
    const clipboardAtPress = await clipboardFingerprint();

    const langData = getLangCache();
    // Sent before the link is fetched (up to half a minute) so the press is acknowledged at once.
    // It shows the user's selection, not the resolved prompt, and names the configured provider.
    sendWebNotification(
      t(langData, 'notify.queued.title', { provider: getProviderLabel(config.targetUrl) }),
      t(langData, 'notify.queued.body', { prompt: compactPreview(rawText, 36) }),
      'info',
    );
    const resolved = await resolveUrlPrompt(rawText, {
      langData,
      youtubePrompt: config.youtubePrompt,
      targetUrl: config.targetUrl,
      onLog: sendLog,
    });
    const prompt = resolved.prompt;
    const targetUrl = resolved.forceProviderUrl ?? config.targetUrl;

    const id = createTaskId();
    queue.enqueue({
      id,
      prompt,
      displayPrompt: resolved.displayPrompt,
      targetUrl,
      title: resolved.title,
      source: 'hotkey',
      clipboardFingerprint: clipboardAtPress,
      ...(resolved.map ? { mapPlace: resolved.map } : {}),
    });
    sendLog(`[${id}] 🔥 Queued for ${getProviderLabel(targetUrl)} (queue size: ${queue.size + 1})`);
  });

  if (!accelerator) {
    sendLog('⌨️  Ask hotkey disabled');
    return true;
  }
  if (ok) {
    sendLog(`⌨️  Hotkey registered: ${accelerator}`);
    return true;
  }
  sendLog(`❌ Failed to register hotkey ${accelerator} — another app may already use it`);
  notifyHotkeyFailed(accelerator);
  return false;
}

function notifyHotkeyFailed(accelerator: string): void {
  const langData = getLangCache();
  sendWebNotification(
    t(langData, 'hotkey.notify.title'),
    t(langData, 'hotkey.notify.failed', { hotkey: accelerator }),
    'warning',
  );
}

export function mainAccelerator(settings: { hotkey: string; hotkeyEnabled: boolean }): string {
  return settings.hotkeyEnabled ? settings.hotkey : '';
}

export function quickExportAccelerator(settings: QuickExportSettings): string {
  return settings.enabled ? settings.hotkey : '';
}

export function bindQuickExportHotkey(): boolean {
  const accelerator = quickExportAccelerator(config.quickExport);
  const ok = registerHotkey('quickExport', accelerator, () => {
    void runQuickExport();
  });

  if (!accelerator) {
    sendLog('⌨️  Quick export hotkey disabled');
    return true;
  }
  if (ok) {
    sendLog(`⌨️  Quick export hotkey registered: ${accelerator}`);
    return true;
  }
  sendLog(`❌ Failed to register quick export hotkey ${accelerator} — another app may already use it`);
  notifyHotkeyFailed(accelerator);
  return false;
}
