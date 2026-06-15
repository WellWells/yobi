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
import type { QueueManager } from './queueManager';

export interface HotkeyDeps {
  queue: QueueManager;
}

let _accessibilityPrompted = false;

export function bindHotkey(deps: HotkeyDeps): void {
  const { queue } = deps;
  const ok = registerHotkey(config.hotkey, async () => {
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

  if (ok) {
    sendLog(`⌨️  Hotkey registered: ${config.hotkey}`);
  } else {
    sendLog(`❌ Failed to register hotkey ${config.hotkey}`);
  }
}
