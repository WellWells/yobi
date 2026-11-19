/**
 * The writers behind the Settings page: each checks a value, saves it and applies what it needs
 * (a hotkey re-bound, the tray menu rebuilt, the login item updated). The IPC handlers and the Yobi
 * connector both call these, so a setting changed from /agent behaves exactly like one changed by hand.
 */
import type { CaptureSettings, HotkeyBindResult, LinkAnalysisPreferences } from '../../shared/types';
import { isThemePreference } from '../../shared/themes';
import { mergeReadingPrefs, readingPrefsFromConfig, readingPrefsToConfig } from '../../shared/readingPrefs';
import type { ReadingPrefs } from '../../shared/readingPrefs';
import { isLinkRecognitionTarget, withLinkRecognition } from '../../shared/linkRecognition';
import type { LinkRecognitionState } from '../../shared/linkRecognition';
import { isRegisterableAccelerator } from '../../shared/shortcuts';
import { PROMPT_TEMPLATE_MAX_CHARS } from '../../shared/promptAuthor';
import {
  config,
  saveConfig,
  normalizePromptPreferences,
  normalizeCaptureSettings,
  normalizeQuickExport,
  normalizeHiddenSources,
  normalizeNotifyEvents,
} from '../config';
import type { Config } from '../config';
import { normalizeBotByokCommands, normalizeBuiltinCommands, normalizeLinkAnalysisPreferences, normalizeProviderCommands } from '../configNormalizers';
import { sendLog, applyLaunchAtStartup } from '../helpers';
import { wouldCollide } from '../hotkey';
import { loadLanguageData, setLangCache } from '../i18n';
import { isSelectableAnalysisTarget } from '../linkAnalysis';
import { broadcastLinkRecognition, currentLinkRecognition } from '../linkRecognition';
import { rebroadcastFlowMetrics } from '../flowMetrics';
import { announceSkills } from './skills';
import type { IpcContext } from './context';

let ctx: IpcContext | null = null;

/** Called once when the IPC handlers are registered: the hotkeys, tray and bots the writers touch. */
export function setSettingsContext(next: IpcContext): void {
  ctx = next;
}

/** The plain on/off settings that need nothing besides being saved. */
export type PlainFlag = 'syncSystemLanguageToModel' | 'oneShotTemporaryChat' | 'providerFallback' | 'showTokenUsage' | 'showRecap' | 'backdropMotion';

export function applyPlainFlag(key: PlainFlag, enabled: unknown): void {
  const value = Boolean(enabled);
  config[key] = value;
  saveConfig({ [key]: value } as Partial<Config>);
}

export function applyHotkey(raw: unknown): HotkeyBindResult {
  const next = typeof raw === 'string' ? raw : '';
  if (!isRegisterableAccelerator(next)) return 'taken';
  if (wouldCollide(next, config.hotkey, config.quickExport.hotkey, config.regionHotkey)) return 'conflict';

  // Bind BEFORE persisting: registerHotkey releases the current accelerator to try the new
  // one, so a combo the OS refuses leaves no hotkey at all, and persisting it first would
  // keep that dead combo across every restart.
  const previous = config.hotkey;
  config.hotkey = next;
  if (ctx && !ctx.bindHotkey()) {
    config.hotkey = previous;
    ctx.bindHotkey();
    sendLog(`⌨️  ${next} was refused by the system — keeping ${previous}`);
    return 'taken';
  }
  saveConfig({ hotkey: next });
  if (next) sendLog(`⌨️  Hotkey updated to: ${next}`);
  return 'ok';
}

export function applyRegionHotkey(raw: unknown): HotkeyBindResult {
  const next = typeof raw === 'string' ? raw.trim() : '';
  if (!isRegisterableAccelerator(next)) return 'taken';
  if (wouldCollide(next, config.regionHotkey, config.hotkey, config.quickExport.hotkey)) return 'conflict';

  // Bound before it is saved, for the same reason as the ask hotkey above.
  const previous = config.regionHotkey;
  config.regionHotkey = next;
  if (ctx && !ctx.bindRegionHotkey()) {
    config.regionHotkey = previous;
    ctx.bindRegionHotkey();
    sendLog(`⌨️  ${next} was refused by the system — keeping ${previous}`);
    return 'taken';
  }
  saveConfig({ regionHotkey: next });
  if (next) sendLog(`⌨️  Screen region hotkey updated to: ${next}`);
  return 'ok';
}

export function applyQuickExport(settings: unknown): HotkeyBindResult {
  const next = normalizeQuickExport(settings);
  if (wouldCollide(next.hotkey, config.quickExport.hotkey, config.hotkey, config.regionHotkey)) return 'conflict';

  const previousHotkey = config.quickExport.hotkey;
  config.quickExport = next;
  if (next.hotkey === previousHotkey) {
    saveConfig({ quickExport: config.quickExport });
    return 'ok';
  }
  if (ctx && !ctx.bindQuickExportHotkey()) {
    // Only the combo goes back — everything else the user just changed still applies.
    config.quickExport = { ...next, hotkey: previousHotkey };
    ctx.bindQuickExportHotkey();
    saveConfig({ quickExport: config.quickExport });
    sendLog(`⌨️  ${next.hotkey} was refused by the system — keeping ${previousHotkey}`);
    return 'taken';
  }
  saveConfig({ quickExport: config.quickExport });
  return 'ok';
}

export function applyHiddenSources(raw: unknown): void {
  const next = normalizeHiddenSources(raw);
  config.hiddenProviders = next.providers;
  config.hiddenByokIds = next.byokIds;
  config.hiddenByokGroupIds = next.byokGroupIds;
  saveConfig({
    hiddenProviders: config.hiddenProviders,
    hiddenByokIds: config.hiddenByokIds,
    hiddenByokGroupIds: config.hiddenByokGroupIds,
  });
  void ctx?.telegramRuntime.refreshBotCommands();
}

export function applyPromptPreferences(raw: unknown): void {
  config.promptPreferences = normalizePromptPreferences(raw);
  saveConfig({ promptPreferences: config.promptPreferences });
}

export function applyLinkAnalysis(raw: unknown): LinkAnalysisPreferences {
  const next = normalizeLinkAnalysisPreferences(raw);
  const current = config.linkAnalysis;
  if (next.mapsPrompt.length > PROMPT_TEMPLATE_MAX_CHARS) throw new Error('Maps prompt is too long');
  if (!isSelectableAnalysisTarget(next.mapsTargetUrl, current?.mapsTargetUrl)
    || !isSelectableAnalysisTarget(next.articleTargetUrl, current?.articleTargetUrl)) {
    throw new Error('Unknown analysis model');
  }
  saveConfig({ linkAnalysis: next });
  return config.linkAnalysis;
}

export function applyYoutubePrompt(raw: unknown): void {
  config.youtubePrompt = typeof raw === 'string' ? raw : '';
  saveConfig({ youtubePrompt: config.youtubePrompt });
}

/** Seconds a web answer may take before it is given up, 15–300; false for a value that is no number. */
export function applyResponseTimeout(ms: unknown): boolean {
  const clamped = Math.max(15_000, Math.min(300_000, Number(ms)));
  if (!Number.isFinite(clamped)) return false;
  config.responseTimeout = clamped;
  saveConfig({ responseTimeout: clamped });
  return true;
}

export function applyNotifyOnComplete(enabled: unknown): void {
  config.notifyOnComplete = Boolean(enabled);
  saveConfig({ notifyOnComplete: config.notifyOnComplete });
  sendLog(`🔔 Completion notification ${config.notifyOnComplete ? 'enabled' : 'disabled'}`);
  ctx?.onTrayMenuRebuild?.();
}

export function applyNotifyEvents(raw: unknown): void {
  config.notifyEvents = normalizeNotifyEvents(raw);
  saveConfig({ notifyEvents: config.notifyEvents });
}

export function applyLaunchAtStartupSetting(enabled: unknown): void {
  config.launchAtStartup = Boolean(enabled);
  saveConfig({ launchAtStartup: config.launchAtStartup });
  applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
  ctx?.onTrayMenuRebuild?.();
}

export function applyCloseToTray(enabled: unknown): void {
  config.closeToTray = Boolean(enabled);
  saveConfig({ closeToTray: config.closeToTray });
  applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
  ctx?.onTraySettingsChanged?.();
}

export function applyMetricsEnabled(enabled: unknown): void {
  config.metricsEnabled = Boolean(enabled);
  saveConfig({ metricsEnabled: config.metricsEnabled });
  sendLog(`📊 Usage statistics ${config.metricsEnabled ? 'enabled' : 'disabled'}`);
}

export function applyTheme(theme: unknown): boolean {
  if (!isThemePreference(theme)) return false;
  saveConfig({ theme });
  return true;
}

export function applyLayoutMode(layoutMode: unknown): void {
  saveConfig({ layoutMode: layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked' });
}

/** The reading size in percent, 70–200 in steps of 10. */
export function applyMarkdownZoom(zoom: unknown): void {
  saveConfig({ markdownZoom: Math.min(200, Math.max(70, Math.round(Number(zoom) / 10) * 10)) });
}

export function applyReadingPrefs(patch: unknown): ReadingPrefs {
  const next = mergeReadingPrefs(readingPrefsFromConfig(config), patch);
  saveConfig(readingPrefsToConfig(next));
  return next;
}

export function applyCaptureSettings(settings: unknown): void {
  config.captureSettings = normalizeCaptureSettings(settings as CaptureSettings);
  saveConfig({ captureSettings: config.captureSettings });
}

/** A switch a site has no row for here (a Taiwan-only site outside Taiwan) is left as it is. */
export function applyLinkRecognition(target: unknown, on: unknown): LinkRecognitionState {
  const current = currentLinkRecognition();
  const shown = target === 'maps' || current.sites.some((entry) => entry.site === target);
  if (!isLinkRecognitionTarget(target) || typeof on !== 'boolean' || !shown) return current;
  config.linkRecognition = withLinkRecognition(config.linkRecognition ?? {}, target, on);
  saveConfig({ linkRecognition: config.linkRecognition });
  broadcastLinkRecognition();
  return currentLinkRecognition();
}

/** `markUserSet`: the user picked it (Settings, the connector), not the system language at first run. */
export function applyLocale(lang: unknown, markUserSet: boolean): boolean {
  const nextLocale = (typeof lang === 'string' ? lang : '').trim();
  if (!nextLocale) return false;
  config.locale = nextLocale;
  if (markUserSet) config.localeSetByUser = true;
  saveConfig(markUserSet ? { locale: nextLocale, localeSetByUser: true } : { locale: nextLocale });
  // Yobi's language is half of where the user is: the link switches' defaults and the Taiwan row follow it.
  broadcastLinkRecognition();
  // Region-specific built-in skills (Taiwan price comparison) follow the interface language.
  announceSkills();
  void loadLanguageData(nextLocale).then((data) => {
    if (!data) return;
    setLangCache(data);
    rebroadcastFlowMetrics();
    ctx?.onTrayMenuRebuild?.();
    void ctx?.telegramRuntime.syncWithConfig();
  });
  return true;
}

/** Saves the bots' built-in commands and refreshes Telegram's command menu; false when that refresh failed. */
export async function applyBuiltinCommands(value: unknown): Promise<boolean> {
  config.builtinCommands = normalizeBuiltinCommands(value);
  saveConfig({ builtinCommands: config.builtinCommands });
  return refreshBotCommandMenu();
}

/** Saves which AI sites' bot commands are on (and their names); false when the menu refresh failed. */
export async function applyProviderCommands(value: unknown): Promise<boolean> {
  config.providerCommands = normalizeProviderCommands(value);
  saveConfig({ providerCommands: config.providerCommands });
  return refreshBotCommandMenu();
}

/** Saves which API keys and key groups have a bot command (`false` = off); false when the menu refresh failed. */
export async function applyBotByokCommands(value: unknown): Promise<boolean> {
  config.botByokCommands = normalizeBotByokCommands(value);
  saveConfig({ botByokCommands: config.botByokCommands });
  return refreshBotCommandMenu();
}

export async function refreshBotCommandMenu(): Promise<boolean> {
  try {
    await ctx?.telegramRuntime.refreshBotCommands();
    return true;
  } catch (err: unknown) {
    sendLog(`⚠️ Failed to refresh the Telegram command menu: ${(err as Error).message}`);
    return false;
  }
}
