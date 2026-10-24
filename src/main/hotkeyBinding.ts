import { ownsAccelerator, registerHotkey } from './hotkey';
import { config, regionHotkeyFilledIn } from './config';
import { settleFilledInRegionHotkey } from './regionHotkeyDefault';
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
import { runRegionCapture } from './regionCapture';
import type { QueueManager } from './queueManager';
import type { FlowDefinition } from '../shared/types';
import { compactPreview } from '../shared/textBudget';

export interface HotkeyDeps {
  queue: QueueManager;
}

let _accessibilityPrompted = false;

export function bindHotkey(deps: HotkeyDeps): boolean {
  const { queue } = deps;
  // An empty combo is the only "off": registerHotkey then releases the slot and binds nothing.
  const accelerator = config.hotkey.trim();
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
      ...(resolved.forceProviderUrl ? { providerPinned: true as const } : {}),
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
  reportBindFailure('hotkey', accelerator);
  return false;
}

/**
 * The OS also refuses a combo this app already holds (another of its hotkeys, or a flow's). Only
 * when it does not is "another app may already use it" true, and worth a notice.
 */
function reportBindFailure(what: string, accelerator: string): void {
  if (ownsAccelerator(accelerator)) {
    sendLog(`❌ Failed to register ${what} ${accelerator} — Yobi already uses it (another hotkey or a flow)`);
    return;
  }
  sendLog(`❌ Failed to register ${what} ${accelerator} — another app may already use it`);
  const langData = getLangCache();
  sendWebNotification(
    t(langData, 'hotkey.notify.title'),
    t(langData, 'hotkey.notify.failed', { hotkey: accelerator }),
    'warning',
  );
}

/** Box a screen region and ask about it; the capture itself lives in regionCapture/. */
export function bindRegionHotkey(): boolean {
  const accelerator = config.regionHotkey.trim();
  const ok = registerHotkey('region', accelerator, () => {
    void runRegionCapture();
  });

  if (!accelerator) {
    sendLog('⌨️  Screen region hotkey disabled');
    return true;
  }
  if (ok) {
    sendLog(`⌨️  Screen region hotkey registered: ${accelerator}`);
    return true;
  }
  reportBindFailure('screen region hotkey', accelerator);
  return false;
}

/**
 * Startup's region bind. Flows register only after flows.json is read, so a filled-in default
 * would take a flow's combo first: it is checked against the flows before it is bound. A stored
 * combo is bound at once, as before.
 */
export async function bindRegionHotkeyAtLaunch(loadFlows: () => Promise<FlowDefinition[]>): Promise<boolean> {
  if (regionHotkeyFilledIn()) await settleFilledInRegionHotkey(loadFlows);
  return bindRegionHotkey();
}

export function bindQuickExportHotkey(): boolean {
  const accelerator = config.quickExport.hotkey.trim();
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
  reportBindFailure('quick export hotkey', accelerator);
  return false;
}
