import { registerHotkey } from './hotkey';
import { config } from './config';
import { getProviderLabel } from './providers';
import { sendLog, sendWebNotification, createTaskId } from './helpers';
import {
  captureSelectedText,
  checkMacosAccessibility,
  promptMacosAccessibility,
} from './clipboard';
import { getLangCache } from './i18n';
import { resolveUrlPrompt } from './urlParser';
import { runQuickExport } from './quickExport';
import type { QueueManager } from './queueManager';
import type { QuickExportSettings } from '../shared/types';

export interface HotkeyDeps {
  queue: QueueManager;
}

let _accessibilityPrompted = false;

/**
 * Reports whether the accelerator actually took. The capture hotkey used to swallow this —
 * a combination another app owned was logged and nothing else, so the settings field showed
 * a binding that never fired. Quick export already warned; both now behave the same.
 */
export function bindHotkey(deps: HotkeyDeps): boolean {
  const { queue } = deps;
  const accelerator = mainAccelerator(config);
  const ok = registerHotkey('main', accelerator, async () => {
    if (process.platform === 'darwin' && !checkMacosAccessibility()) {
      const langData = getLangCache();
      const errorMsg = langData['hotkey.error.accessibility'] ??
        'Accessibility permission required. Go to System Preferences → Privacy & Security → Accessibility and enable this app.';
      sendLog(`❌ ${errorMsg}`);
      sendWebNotification('Yobi', errorMsg, 'warning');
      if (!_accessibilityPrompted) {
        _accessibilityPrompted = true;
        promptMacosAccessibility();
      }
      return;
    }

    const rawText = await captureSelectedText();
    if (!rawText) {
      sendLog('⚠️  Clipboard is empty — nothing to send');
      return;
    }

    const langData = getLangCache();
    const resolved = await resolveUrlPrompt(rawText, {
      langData,
      youtubePrompt: config.youtubePrompt,
      onLog: sendLog,
      onNotify: (title, body) => sendWebNotification(title, body, 'info'),
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
    });
    sendLog(`[${id}] 🔥 Queued for ${getProviderLabel(targetUrl)} (queue size: ${queue.size + 1})`);

    const notifyTitle = langData['notify.queued.title'] ?? 'Yobi';
    const notifyBodyTemplate = langData['notify.queued.body'] ?? 'Queued: "{{prompt}}"';
    const compactPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 36);
    const displayPrompt = compactPrompt.length < prompt.replace(/\s+/g, ' ').trim().length
      ? `${compactPrompt}…`
      : compactPrompt;
    sendWebNotification(notifyTitle, notifyBodyTemplate.replace('{{prompt}}', displayPrompt), 'info');
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
    langData['hotkey.notify.title'] ?? 'Yobi',
    (langData['hotkey.notify.failed'] ?? 'Could not register {{hotkey}} — another app may already use it')
      .replace('{{hotkey}}', accelerator),
    'warning',
  );
}

/**
 * Both slots are bound from TWO values — the combination and its on/off switch — so the
 * derivation lives in one place per slot and every "did the binding change?" comparison goes
 * through it. Switching off must yield blank (how registerHotkey releases a slot) while the
 * recorded combination stays in config, so flicking the switch back is all it takes.
 */
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
