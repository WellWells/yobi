/**
 * The rows of the Settings page the Yobi connector can read and change (`yobiSettings.ts`). Each
 * writer is the one the page's own IPC handler calls (`ipc/settingsApply.ts` and friends), never a
 * second copy. What is left out, and why, is `SETTINGS_NOT_HERE`.
 */
import {
  AGENT_ASK_TTL_MAX_MINUTES, AGENT_ASK_TTL_MIN_MINUTES, MAX_CAPTURE_MARGIN, MAX_CAPTURE_WIDTH, MAX_CARD_OPACITY, MIN_CARD_OPACITY, MIN_CAPTURE_WIDTH, PROVIDERS,
} from '../../shared/types';
import type { HotkeyBindResult, NotifyEventPrefs, PromptPreferences } from '../../shared/types';
import { THEME_DEFS } from '../../shared/themes';
import { READING_FONTS, readingPrefsFromConfig } from '../../shared/readingPrefs';
import { CAPTURE_BACKGROUND_STYLES, CAPTURE_DIRECTIONS, CAPTURE_PALETTES } from '../../shared/capturePalettes';
import { BOT_DOWNLOAD_CAP_CHOICES, DOWNLOADS_KEEP_CHOICES, normalizeBotDownloadCap, normalizeDownloadsKeep } from '../../shared/downloads';
import { SHARE_EXPIRE_VALUES } from '../../shared/shareExpire';
import { BUILTIN_CONNECTORS } from '../../shared/builtinConnectors';
import { PROMPT_TEMPLATE_MAX_CHARS } from '../../shared/promptAuthor';
import { config, getHiddenSources } from '../config';
import { EDITOR_PRESET_IDS } from '../editorPresets';
import { currentLinkRecognition } from '../linkRecognition';
import { getMcpRegistry } from '../mcp';
import {
  applyBotByokCommands, applyBuiltinCommands, applyCaptureSettings, applyCloseToTray, applyHiddenSources, applyHotkey, applyLaunchAtStartupSetting,
  applyLayoutMode, applyLinkAnalysis, applyLinkRecognition, applyLocale, applyMarkdownZoom, applyMetricsEnabled,
  applyNotifyEvents, applyNotifyOnComplete, applyPlainFlag, applyPromptPreferences, applyProviderCommands, applyQuickExport, applyReadingPrefs,
  applyRegionHotkey, applyResponseTimeout, applyTheme, applyYoutubePrompt,
} from '../ipc/settingsApply';
import { applyEditorSettings } from '../ipc/composerEditor';
import { applyShareSettings } from '../ipc/share';
import { setBotDownloadCap, setDownloadsKeep } from '../ipc/ytdl';
import { listLanguagePacks } from '../ipc/locale';
import type { SettingSpec } from './yobiSettings';

const CUSTOM_INSTRUCTIONS_MAX = 4_000;
const NICKNAME_MAX = 60;
/** The editor setting as the user sees it: '' is stored for "pick one by itself". */
const EDITOR_AUTO = 'auto';

function hotkeyRefusal(result: HotkeyBindResult): string | void {
  if (result === 'conflict') return 'another Yobi hotkey already uses that combination';
  if (result === 'taken') return 'the system or another program refused that combination';
}

function prefsWith(patch: Partial<PromptPreferences>): PromptPreferences {
  return { ...config.promptPreferences, ...patch };
}

function hiddenChoices(): string[] {
  return [
    ...PROVIDERS,
    ...config.byokInstances.map((key) => `byok:${key.id}`),
    ...config.byokGroups.map((group) => `byokgroup:${group.id}`),
  ];
}

function hiddenList(): string[] {
  const hidden = getHiddenSources();
  return [...hidden.providers, ...hidden.byokIds.map((id) => `byok:${id}`), ...hidden.byokGroupIds.map((id) => `byokgroup:${id}`)];
}

function setHidden(list: string[]): void {
  const pick = (prefix: string) => list.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
  applyHiddenSources({ providers: list.filter((id) => !id.includes(':')), byokIds: pick('byok:'), byokGroupIds: pick('byokgroup:') });
}

function keyCommandChoices(): string[] {
  return hiddenChoices().filter((id) => id.includes(':'));
}

function keyCommandsOn(): string[] {
  return keyCommandChoices().filter((choice) => config.botByokCommands[choice.slice(choice.indexOf(':') + 1)] !== false);
}

async function setKeyCommandsOn(list: string[]): Promise<void> {
  const on = new Set(list);
  await applyBotByokCommands(Object.fromEntries(keyCommandChoices()
    .filter((choice) => !on.has(choice))
    .map((choice) => [choice.slice(choice.indexOf(':') + 1), false])));
}

function notifyRow(key: keyof NotifyEventPrefs, id: string, about: string): SettingSpec {
  return {
    id, section: 'notifications', about, kind: 'boolean',
    read: () => config.notifyEvents[key],
    write: (on: boolean) => applyNotifyEvents({ ...config.notifyEvents, [key]: on }),
  };
}

function cardRow<K extends keyof typeof config.captureSettings>(key: K, id: string, about: string, spec: Partial<SettingSpec>): SettingSpec {
  return {
    id, section: 'export', about, kind: 'boolean', ...spec,
    read: () => config.captureSettings[key],
    write: (value: never) => applyCaptureSettings({ ...config.captureSettings, [key]: value }),
  };
}

function connectorRows(): SettingSpec[] {
  // Yobi Control itself is not a row: switching it off from here would cut the line it came in on.
  return BUILTIN_CONNECTORS.filter((builtin) => builtin.id !== 'builtin-yobi').map((builtin) => ({
    id: `connector.${builtin.id.replace(/^builtin-/, '')}`,
    section: 'connectors' as const,
    about: `${builtin.descriptor().name} connector on/off`,
    kind: 'boolean' as const,
    read: () => Boolean(config[builtin.flag]),
    write: async (on: boolean) => {
      const registry = getMcpRegistry();
      if (!registry) return 'connectors are still starting';
      const result = await registry.setBuiltinEnabled(builtin.id, on);
      if (!result.ok) return result.error ?? 'the connector could not be switched';
    },
  }));
}

function linkRows(): SettingSpec[] {
  const state = currentLinkRecognition();
  return [
    {
      id: 'links.maps', section: 'links', about: 'A Google Maps link runs the place review analysis', kind: 'boolean',
      read: () => currentLinkRecognition().maps,
      write: (on: boolean) => { applyLinkRecognition('maps', on); },
    },
    ...state.sites.map(({ site }): SettingSpec => ({
      id: `links.${site}`, section: 'links', about: `A ${site} link runs Yobi's built-in reader for it`, kind: 'boolean',
      read: () => currentLinkRecognition().sites.find((entry) => entry.site === site)?.on ?? false,
      write: (on: boolean) => { applyLinkRecognition(site, on); },
    })),
  ];
}

/** Built when asked: the languages, keys and sites on offer change while Yobi runs. */
export async function buildSettingsCatalog(): Promise<SettingSpec[]> {
  const languages = await listLanguagePacks();
  return [
    // AI models
    {
      id: 'models.hidden', section: 'models', kind: 'list', choices: hiddenChoices,
      about: 'Models hidden from the model pickers (providers, byok:<key id>, byokgroup:<group id>)',
      read: hiddenList,
      write: (list: string[]) => setHidden(list),
    },
    {
      id: 'models.temporary_chat_for_tasks', section: 'models', kind: 'boolean',
      about: 'Flows, translations, writing tools and searches use the AI site\'s temporary chats',
      read: () => config.oneShotTemporaryChat,
      write: (on: boolean) => applyPlainFlag('oneShotTemporaryChat', on),
    },
    {
      id: 'models.switch_when_no_answer', section: 'models', kind: 'boolean',
      about: 'When an AI gives no answer, send the message to the next signed-in AI (chat and hotkey)',
      read: () => config.providerFallback,
      write: (on: boolean) => applyPlainFlag('providerFallback', on),
    },
    // AI responses
    {
      id: 'answers.tone', section: 'answers', kind: 'choice', choices: () => ['default', 'professional', 'casual', 'direct'],
      about: 'Tone of the answers', read: () => config.promptPreferences.tone,
      write: (tone: PromptPreferences['tone']) => applyPromptPreferences(prefsWith({ tone })),
    },
    {
      id: 'answers.length', section: 'answers', kind: 'choice', choices: () => ['auto', 'concise', 'detailed'],
      about: 'Length of the answers', read: () => config.promptPreferences.length,
      write: (length: PromptPreferences['length']) => applyPromptPreferences(prefsWith({ length })),
    },
    {
      id: 'answers.custom_instructions', section: 'answers', kind: 'text', maxLength: CUSTOM_INSTRUCTIONS_MAX,
      about: 'Custom instructions added to every prompt', read: () => config.promptPreferences.customInstructions,
      write: (customInstructions: string) => applyPromptPreferences(prefsWith({ customInstructions })),
    },
    {
      id: 'answers.nickname', section: 'answers', kind: 'text', maxLength: NICKNAME_MAX,
      about: 'What the AI calls the user', read: () => config.promptPreferences.nickname ?? '',
      write: (nickname: string) => applyPromptPreferences(prefsWith({ nickname: nickname.trim() })),
    },
    {
      id: 'answers.match_app_language', section: 'answers', kind: 'boolean',
      about: 'Ask the AI to answer in Yobi\'s interface language', read: () => config.syncSystemLanguageToModel,
      write: (on: boolean) => applyPlainFlag('syncSystemLanguageToModel', on),
    },
    {
      id: 'answers.youtube_prompt', section: 'answers', kind: 'text', maxLength: PROMPT_TEMPLATE_MAX_CHARS,
      about: 'Prompt template for YouTube video summaries', read: () => config.youtubePrompt,
      write: (prompt: string) => applyYoutubePrompt(prompt),
    },
    {
      id: 'answers.maps_prompt', section: 'answers', kind: 'text', maxLength: PROMPT_TEMPLATE_MAX_CHARS,
      about: 'Prompt template for Google Maps review analysis', read: () => config.linkAnalysis?.mapsPrompt ?? '',
      write: (mapsPrompt: string) => { applyLinkAnalysis({ ...config.linkAnalysis, mapsPrompt }); },
    },
    {
      id: 'answers.timeout_seconds', section: 'answers', kind: 'number', min: 15, max: 300,
      about: 'Seconds to wait for an AI site\'s answer before giving up', read: () => Math.round(config.responseTimeout / 1000),
      write: (seconds: number) => (applyResponseTimeout(Math.round(seconds) * 1000) ? undefined : 'not a number of seconds'),
    },
    // Connectors
    ...connectorRows(),
    // Bots
    {
      id: 'bots.search_command', section: 'bots', kind: 'boolean',
      about: 'The bots\' built-in web search command is on', read: () => config.builtinCommands.search.enabled,
      write: async (on: boolean) => {
        await applyBuiltinCommands({ ...config.builtinCommands, search: { ...config.builtinCommands.search, enabled: on } });
      },
    },
    {
      id: 'bots.model_commands', section: 'bots', kind: 'list', choices: () => [...PROVIDERS],
      about: 'AI sites that have a bot command (for example /gemini) in the bots\' menus',
      read: () => PROVIDERS.filter((provider) => config.providerCommands[provider]?.enabled !== false),
      write: async (list: string[]) => {
        await applyProviderCommands(Object.fromEntries(PROVIDERS.map((provider) => [
          provider, { ...config.providerCommands[provider], enabled: list.includes(provider) },
        ])));
      },
    },
    {
      id: 'bots.key_commands', section: 'bots', kind: 'list', choices: keyCommandChoices,
      about: 'BYOK models (byok:<key id>) and key groups (byokgroup:<group id>) that have a bot command in the bots\' menus',
      read: keyCommandsOn,
      write: setKeyCommandsOn,
    },
    {
      id: 'bots.reply_wait_minutes', section: 'bots', kind: 'number', min: AGENT_ASK_TTL_MIN_MINUTES, max: AGENT_ASK_TTL_MAX_MINUTES,
      about: 'Minutes a bot waits for the user\'s reply after the AI asks a question', read: () => config.builtinCommands.askTtlMinutes,
      write: async (minutes: number) => { await applyBuiltinCommands({ ...config.builtinCommands, askTtlMinutes: minutes }); },
    },
    // General
    {
      id: 'general.language', section: 'general', kind: 'choice', choices: () => languages,
      about: 'Yobi\'s interface language', read: () => config.locale,
      write: (locale: string) => (applyLocale(locale, true) ? undefined : 'no such language'),
    },
    {
      id: 'general.close_to_tray', section: 'general', kind: 'boolean',
      about: 'Closing the window keeps Yobi running in the tray', read: () => config.closeToTray,
      write: (on: boolean) => applyCloseToTray(on),
    },
    {
      id: 'general.launch_at_startup', section: 'general', kind: 'boolean',
      about: 'Start Yobi when the user signs in to the computer', read: () => config.launchAtStartup,
      write: (on: boolean) => applyLaunchAtStartupSetting(on),
    },
    {
      id: 'general.external_editor', section: 'general', kind: 'choice',
      choices: () => [EDITOR_AUTO, 'system', ...EDITOR_PRESET_IDS],
      about: 'Editor Ctrl+G opens for the message being written (auto = picked by itself)',
      read: () => config.externalEditor || EDITOR_AUTO,
      write: (choice: string) => { applyEditorSettings({ choice: choice === EDITOR_AUTO ? '' : choice }); },
    },
    // Appearance
    {
      id: 'appearance.theme', section: 'appearance', kind: 'choice', choices: () => ['auto', ...Object.keys(THEME_DEFS)],
      about: 'Colour theme (auto follows the system)', read: () => config.theme,
      write: (theme: string) => (applyTheme(theme) ? undefined : 'no such theme'),
    },
    {
      id: 'appearance.background_motion', section: 'appearance', kind: 'boolean',
      about: 'Whether the flowing background of the silk and aurora themes moves', read: () => config.backdropMotion,
      write: (on: boolean) => applyPlainFlag('backdropMotion', on),
    },
    {
      id: 'appearance.reply_layout', section: 'appearance', kind: 'choice', choices: () => ['stacked', 'side-by-side'],
      about: 'Prompt and reply above each other or side by side', read: () => config.layoutMode,
      write: (mode: string) => applyLayoutMode(mode),
    },
    {
      id: 'appearance.reading_size_percent', section: 'appearance', kind: 'number', min: 70, max: 200,
      about: 'Text size of conversations, in steps of 10', read: () => config.markdownZoom,
      write: (zoom: number) => applyMarkdownZoom(zoom),
    },
    {
      id: 'appearance.reading_font', section: 'appearance', kind: 'choice', choices: () => READING_FONTS,
      about: 'Typeface of conversations', read: () => readingPrefsFromConfig(config).font,
      write: (font: string) => { applyReadingPrefs({ font }); },
    },
    {
      id: 'appearance.full_width', section: 'appearance', kind: 'boolean',
      about: 'Conversations use the whole window width', read: () => readingPrefsFromConfig(config).fullWidth,
      write: (fullWidth: boolean) => { applyReadingPrefs({ fullWidth }); },
    },
    {
      id: 'appearance.show_token_counts', section: 'appearance', kind: 'boolean',
      about: 'Token usage under each reply', read: () => config.showTokenUsage,
      write: (on: boolean) => applyPlainFlag('showTokenUsage', on),
    },
    {
      id: 'appearance.show_recap', section: 'appearance', kind: 'boolean',
      about: 'The recap icon at the bottom of a conversation', read: () => config.showRecap,
      write: (on: boolean) => applyPlainFlag('showRecap', on),
    },
    // Notifications
    {
      id: 'notify.all', section: 'notifications', kind: 'boolean',
      about: 'Desktop notifications at all (the switch above the ones below)', read: () => config.notifyOnComplete,
      write: (on: boolean) => applyNotifyOnComplete(on),
    },
    notifyRow('chatComplete', 'notify.chat_complete', 'Notify when a chat answer is ready'),
    notifyRow('chatFailure', 'notify.chat_failure', 'Notify when a chat request fails'),
    notifyRow('flowSuccess', 'notify.flow_success', 'Notify when a flow run succeeds'),
    notifyRow('flowFailure', 'notify.flow_failure', 'Notify when a flow run fails'),
    notifyRow('botRequests', 'notify.bot_requests', 'Notify when someone asks to use a bot or a bot is added to a group'),
    // Links and downloads
    ...linkRows(),
    {
      id: 'links.downloads_keep', section: 'links', kind: 'choice', choices: () => DOWNLOADS_KEEP_CHOICES,
      about: 'How long Downloads/Yobi keeps what Yobi downloaded (keep = until deleted)', read: () => normalizeDownloadsKeep(config.downloadsKeep),
      write: (keep: string) => { setDownloadsKeep(keep); },
    },
    {
      id: 'links.bot_download_cap', section: 'links', kind: 'choice', choices: () => BOT_DOWNLOAD_CAP_CHOICES,
      about: 'Largest file in MB a bot user without the admin right may download (none = only what the chat itself takes)',
      read: () => normalizeBotDownloadCap(config.botDownloadCap),
      write: (cap: string) => { setBotDownloadCap(cap); },
    },
    // Export
    {
      id: 'export.quick_format', section: 'export', kind: 'choice', choices: () => ['png', 'webp', 'pdf', 'text'],
      about: 'Default format of the quick export panel (text = share link)', read: () => config.quickExport.format,
      write: (format: string) => hotkeyRefusal(applyQuickExport({ ...config.quickExport, format })),
    },
    {
      id: 'export.quick_zip', section: 'export', kind: 'boolean',
      about: 'Quick export wraps the card in a ZIP', read: () => config.quickExport.zip,
      write: (zip: boolean) => hotkeyRefusal(applyQuickExport({ ...config.quickExport, zip })),
    },
    cardRow('palette', 'export.card_palette', 'Card colours', { kind: 'choice', choices: () => CAPTURE_PALETTES.map((palette) => palette.key) }),
    cardRow('backgroundStyle', 'export.card_background', 'Card background style', { kind: 'choice', choices: () => CAPTURE_BACKGROUND_STYLES }),
    cardRow('direction', 'export.card_gradient_direction', 'Direction of the card\'s background gradient', { kind: 'choice', choices: () => CAPTURE_DIRECTIONS }),
    cardRow('cardLayout', 'export.card_layout', 'Card layout', { kind: 'choice', choices: () => ['document', 'bubble'] }),
    cardRow('format', 'export.card_format', 'Image format of an exported card', { kind: 'choice', choices: () => ['png', 'webp', 'pdf'] }),
    cardRow('range', 'export.card_range', 'Export the whole conversation or only the last reply', { kind: 'choice', choices: () => ['all', 'last'] }),
    cardRow('showPrompt', 'export.card_show_prompt', 'The card shows the prompt', {}),
    cardRow('showProvider', 'export.card_show_model', 'The card shows the model name', {}),
    cardRow('showTimestamp', 'export.card_show_time', 'The card shows the time', {}),
    cardRow('showTokens', 'export.card_show_tokens', 'The card shows token counts', {}),
    cardRow('width', 'export.card_width', 'Card width in pixels', { kind: 'number', min: MIN_CAPTURE_WIDTH, max: MAX_CAPTURE_WIDTH }),
    cardRow('margin', 'export.card_margin', 'Card margin in pixels', { kind: 'number', min: 0, max: MAX_CAPTURE_MARGIN }),
    cardRow('cardOpacity', 'export.card_opacity', 'How opaque the card under the text is, in percent (lower lets the background show through)', { kind: 'number', min: MIN_CARD_OPACITY, max: MAX_CARD_OPACITY }),
    {
      id: 'export.card_pixel_ratio', section: 'export', kind: 'choice', choices: () => ['1', '2'],
      about: 'Card resolution (2 = sharp on high-DPI screens)', read: () => String(config.captureSettings.pixelRatio),
      write: (ratio: string) => applyCaptureSettings({ ...config.captureSettings, pixelRatio: Number(ratio) }),
    },
    cardRow('zip', 'export.card_zip', 'An exported card is wrapped in a ZIP', {}),
    {
      id: 'export.share_expiry', section: 'export', kind: 'choice', choices: () => SHARE_EXPIRE_VALUES,
      about: 'How long a share link lasts', read: () => config.share.expire,
      write: (expire: string) => { applyShareSettings({ expire: expire as typeof config.share.expire }); },
    },
    {
      id: 'export.share_burn_after_reading', section: 'export', kind: 'boolean',
      about: 'A share link is deleted once opened', read: () => config.share.burnAfterReading,
      write: (on: boolean) => { applyShareSettings({ burnAfterReading: on }); },
    },
    // Keyboard shortcuts
    {
      id: 'shortcuts.ask_hotkey', section: 'shortcuts', kind: 'text', maxLength: 60,
      about: 'Global hotkey that sends the selected text to the AI (Electron accelerator such as Alt+Space; "" = none)',
      read: () => config.hotkey, write: (combo: string) => hotkeyRefusal(applyHotkey(combo.trim())),
    },
    {
      id: 'shortcuts.region_hotkey', section: 'shortcuts', kind: 'text', maxLength: 60,
      about: 'Global hotkey that captures a screen region for the AI ("" = none)',
      read: () => config.regionHotkey, write: (combo: string) => hotkeyRefusal(applyRegionHotkey(combo)),
    },
    {
      id: 'shortcuts.quick_export_hotkey', section: 'shortcuts', kind: 'text', maxLength: 60,
      about: 'Global hotkey that opens the quick export panel ("" = none)',
      read: () => config.quickExport.hotkey, write: (hotkey: string) => hotkeyRefusal(applyQuickExport({ ...config.quickExport, hotkey: hotkey.trim() })),
    },
    // Statistics
    {
      id: 'statistics.enabled', section: 'statistics', kind: 'boolean',
      about: 'Yobi counts requests, tokens and flow runs for the statistics page', read: () => config.metricsEnabled,
      write: (on: boolean) => applyMetricsEnabled(on),
    },
  ];
}
