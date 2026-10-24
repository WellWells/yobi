import { FileOutput, Languages, Scale, ScrollText, Sunrise, WandSparkles, type LucideIcon } from 'lucide-react';
import { buildFlowCronExpression } from '../../../../shared/flowSchedule';
import { COMMON_CURRENCIES } from '../../../../shared/currencies';
import { PROVIDER_URLS } from '../../../../shared/types';
import type { FlowDefinition, FlowVariable, FlowVariableOption, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';
import { DEFAULT_SKILL_CONFIG } from '../../../../shared/flowSkillSchema';
import {
  languageDisplayName,
  promptLanguageName,
  sortedTranslateLanguages,
  uiTargetLanguage,
} from '../../../../shared/translateLanguages';
import {
  COUNCIL_MEMBERS,
  articleBriefingPrompt,
  askPrompt,
  councilMemberPrompt,
  councilSynthesisPrompt,
  lineAlertPrompt,
  lineDigestPrompt,
  telegramDigestPrompt,
  lineTodayPrompt,
  lineTopicsPrompt,
  lineWeeklyPrompt,
  mailDigestPrompt,
  mailWatchPrompt,
  morningBriefPrompt,
  pushesAnalyzePrompt,
  selectionPolishPrompt,
  selectionSummaryPrompt,
  selectionTranslatePrompt,
  stockQuotePrompt,
  stockWatchPrompt,
  summarizeUrlPrompt,
  xPostExplainPrompt,
  youtubeSummaryPrompt,
  ytCommandPrompt,
} from './templatePrompts';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Translate = (key: string) => string;

export type TemplateCategory = 'hotkey' | 'push' | 'command';

/**
 * Gallery identity colour: what the template is about, not what its first step does
 * (`skillHue()`), since most templates start by fetching. Templates over the same source share
 * a hue. `gray` and `dark` are omitted: their `-light` value is darker than the tile on dark themes.
 */
export type TemplateHue =
  | 'green' | 'red' | 'orange' | 'yellow' | 'blue' | 'cyan' | 'teal' | 'violet' | 'pink' | 'indigo';

export interface FlowTemplate {
  key: string;
  category: TemplateCategory;
  titleKey: string;
  descKey: string;
  primarySkill: SkillType;
  hue: TemplateHue;
  /**
   * Overrides the `primarySkill` glyph where the first step misrepresents the whole template
   * — the morning brief is not a weather report, and `/md` converts rather than shares.
   */
  icon?: LucideIcon;
  command?: string;
  /** The global hotkey a `hotkey` template is created with, shown on its tile like `/command`. */
  hotkey?: string;
  setupCount: number;
  build: (t: Translate, locale: string) => FlowDefinition;
}

function step(type: SkillType, config: Record<string, string>, label: string, outputKey = ''): SkillInstance {
  return { id: makeId(), type, label, config, outputKey };
}

function llmConfig(prompt: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...DEFAULT_SKILL_CONFIG.llm, prompt, provider: PROVIDER_URLS.gemini, ...extra };
}

function weekdayCron(hour: number, minute = 0): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    scheduleHour: hour,
    scheduleMinute: minute,
    repeatWithinDay: false,
    repeatEveryUnit: 'hours',
    repeatEveryValue: 1,
    endHour: 23,
    endMinute: 59,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

function intervalCron(value: number, unit: 'minutes' | 'hours' = 'minutes'): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'interval',
    intervalUnit: unit,
    intervalValue: value,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

function hourlyWeekdayCron(startHour: number, endHour: number): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    scheduleHour: startHour,
    scheduleMinute: 0,
    repeatWithinDay: true,
    repeatEveryUnit: 'hours',
    repeatEveryValue: 1,
    endHour,
    endMinute: 0,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

/** These days of every month; a run missed while the PC was off happens at the next launch. */
function monthlyCron(days: number[], hour: number, minute = 0): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'monthly',
    monthDays: days,
    scheduleHour: hour,
    scheduleMinute: minute,
    catchUpMissed: true,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

/** One weekday only — `weekdayCron` is the Mon-Fri variant. */
function singleWeekdayCron(weekday: number, hour: number, minute = 0): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'weekly',
    weekdays: [weekday],
    scheduleHour: hour,
    scheduleMinute: minute,
    repeatWithinDay: false,
    repeatEveryUnit: 'hours',
    repeatEveryValue: 1,
    endHour: 23,
    endMinute: 59,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

/** `botAccess` names who may run the bot command; absent = the default for a new command. */
function commandTriggers(
  command: string,
  descKey: string,
  t: Translate,
  botAccess?: TriggerConfig['botAccess'],
): { trigger: TriggerConfig; extraTriggers: TriggerConfig[] } {
  return {
    trigger: {
      type: 'bot',
      botCommand: command,
      botCommandDescription: t(descKey),
      botInputVariable: 'input',
      ...(botAccess ? { botAccess } : {}),
    },
    extraTriggers: [{ type: 'chat', chatCommand: command, chatCommandDescription: t(descKey), chatInputVariable: 'input' }],
  };
}

function replyStep(t: Translate): SkillInstance {
  return step('bot', {
    chatId: '{{bot.triggerChatId}}',
    message: '{{llm_1}}',
    attachment: '',
    attachmentType: 'auto',
    emitFailFlag: 'true',
  }, t('flow.templates.step.reply'), 'bot_1');
}

/** A reply to whoever sent the command; an X post's media go along with it when given. */
function chatVar(t: Translate): FlowVariable {
  return {
    key: 'chatId',
    type: 'chat',
    label: t('flow.templates.var.chatId.label'),
    question: t('flow.templates.var.chatId.question'),
    hint: t('flow.templates.var.chatId.hint'),
    value: '',
  };
}

function recipientGuard(t: Translate): SkillInstance {
  return step('stop', { value: '{{var.chatId}}' }, t('flow.templates.step.needRecipient'), '');
}

const FX_LOOKUP_CODE = [
  "const raw = (vars['var.fxPairs'] || '');",
  'const NL = String.fromCharCode(10);',
  'const cache = {};',
  'const ratesFor = async (b) => {',
  '  if (!(b in cache)) {',
  "    try { const r = await fetch('https://open.er-api.com/v6/latest/' + b); const j = await r.json(); cache[b] = (j && j.rates) || {}; }",
  '    catch (e) { cache[b] = {}; }',
  '  }',
  '  return cache[b];',
  '};',
  'const out = [];',
  'for (const line of raw.split(NL).map((s) => s.trim()).filter(Boolean)) {',
  '  const parts = line.split(/[^A-Za-z]+/).filter(Boolean);',
  '  if (parts.length < 2) continue;',
  '  const base = parts[0].toUpperCase();',
  '  const target = parts[1].toUpperCase();',
  '  const rate = (await ratesFor(base))[target];',
  "  out.push(typeof rate === 'number' ? ('1 ' + base + ' = ' + Number(rate.toFixed(4)) + ' ' + target) : (base + ' -> ' + target + ': N/A'));",
  '}',
  'return out.join(NL);',
].join('\n');

const MD_TOKEN_SCAN = [
  "const mdRaw = String(vars['input'] || '');",
  'const mdWs = [String.fromCharCode(32), String.fromCharCode(10), String.fromCharCode(9), String.fromCharCode(13)];',
  'let mdStart = 0;',
  'while (mdStart < mdRaw.length && mdWs.indexOf(mdRaw[mdStart]) >= 0) mdStart++;',
  'let mdEnd = mdStart;',
  'while (mdEnd < mdRaw.length && mdWs.indexOf(mdRaw[mdEnd]) < 0) mdEnd++;',
  'const mdFirst = mdRaw.slice(mdStart, mdEnd).toLowerCase();',
  "const mdFlat = mdFirst.split('').filter(function (c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }).join('');",
  "const mdZip = mdFlat.indexOf('zip') === 0;",
  'const mdBase = mdZip ? mdFlat.slice(3) : mdFlat;',
  "const mdIsLink = mdBase === 'text' || mdBase === 'link' || mdBase === 'url';",
  "const mdIsFormat = mdIsLink || mdBase === 'pdf' || mdBase === 'png' || mdBase === 'webp' || (mdZip && mdBase === '');",
].join('\n');

export const MD_FORMAT_CODE = [
  MD_TOKEN_SCAN,
  "if (!mdIsFormat) return 'pdf';",
  "if (mdIsLink) return 'text';",
  "if (mdBase === '') return 'zippdf';",
  "return mdZip ? ('zip' + mdBase) : mdBase;",
].join('\n');

export const MD_BODY_CODE = [
  MD_TOKEN_SCAN,
  'if (!mdIsFormat) return mdRaw;',
  'let mdRest = mdEnd;',
  'while (mdRest < mdRaw.length && mdWs.indexOf(mdRaw[mdRest]) >= 0) mdRest++;',
  'return mdRaw.slice(mdRest);',
].join('\n');

function textVar(key: string, t: Translate, required = true, multiline = false): FlowVariable {
  return {
    key,
    type: 'text',
    label: t(`flow.templates.var.${key}.label`),
    question: t(`flow.templates.var.${key}.question`),
    hint: t(`flow.templates.var.${key}.hint`),
    value: '',
    required,
    ...(multiline ? { multiline: true } : {}),
  };
}

function feedVar(key: string, t: Translate): FlowVariable {
  return {
    key,
    type: 'feed',
    label: t(`flow.templates.var.${key}.label`),
    question: t(`flow.templates.var.${key}.question`),
    hint: t(`flow.templates.var.${key}.hint`),
    value: '',
    required: true,
  };
}

function listSelectorVar(urlKey: string, t: Translate): FlowVariable {
  return {
    key: 'itemSelector',
    type: 'text',
    label: t('flow.templates.var.itemSelector.label'),
    question: t('flow.templates.var.itemSelector.question'),
    hint: t('flow.templates.var.itemSelector.hint'),
    value: '',
    required: false,
    pickTarget: 'list',
    pickUrlKey: urlKey,
    pickWriteKeys: { title: 'titleSelector', link: 'linkSelector' },
  };
}

function derivedSelectorVar(key: string, t: Translate): FlowVariable {
  return {
    key,
    type: 'text',
    label: t(`flow.templates.var.${key}.label`),
    question: t(`flow.templates.var.${key}.question`),
    hint: t(`flow.templates.var.${key}.hint`),
    value: '',
    required: false,
    hiddenInSetup: true,
  };
}

function numberVar(key: string, t: Translate, value: string): FlowVariable {
  return {
    key,
    type: 'number',
    label: t(`flow.templates.var.${key}.label`),
    question: t(`flow.templates.var.${key}.question`),
    hint: t(`flow.templates.var.${key}.hint`),
    value,
    required: true,
    min: '0',
  };
}

function selectVar(key: string, t: Translate, options: FlowVariableOption[], value: string): FlowVariable {
  return {
    key,
    type: 'select',
    label: t(`flow.templates.var.${key}.label`),
    question: t(`flow.templates.var.${key}.question`),
    hint: t(`flow.templates.var.${key}.hint`),
    value,
    required: true,
    options,
  };
}

function currencyOptions(t: Translate): FlowVariableOption[] {
  return COMMON_CURRENCIES.map((code) => ({ value: code, label: `${code} — ${t(`flow.currency.${code}`)}` }));
}

const FOREX_GATE_CODE = [
  'const rate = parseFloat("{{forex_1.rate}}");',
  'const target = parseFloat("{{var.targetPrice}}");',
  'const risingAlert = "{{var.direction}}" === "above";',
  'if (!isFinite(rate) || !isFinite(target)) return "";',
  'return (risingAlert ? rate >= target : rate <= target) ? "hit" : "";',
].join('\n');

function skipEmpty(condKey: string, t: Translate, left: string, operator: string, right = ''): SkillInstance[] {
  return [
    step('if', { left, operator, right }, t(condKey)),
    step('continue', {}, t('flow.skill.continue')),
    step('end_if', {}, t('flow.skill.end_if')),
  ];
}

function whenSet(varKey: string, labelKey: string, t: Translate, ...inner: SkillInstance[]): SkillInstance[] {
  return [
    step('if', { left: `{{var.${varKey}}}`, operator: 'is_true', right: '' }, t(labelKey)),
    ...inner,
    step('end_if', {}, t('flow.skill.end_if')),
  ];
}

/** Telegram or LINE, chosen in setup. A `chat` variable linked to it lists that bot's chats. */
function botPlatformVar(t: Translate): FlowVariable {
  return selectVar('botPlatform', t, [
    { value: 'telegram', label: t('flow.skill.bot.platform.telegram') },
    { value: 'line', label: t('flow.skill.bot.platform.line') },
  ], 'telegram');
}

/** The header is written here, not by the model, so the post link is never retyped. */
const X_POST_HEADER = '**[{{post.name}} ({{post.author}})]({{post.link}})** · {{post.date}}';

function xPostMessage(t: Translate, body: string, labelKey: string, outputKey: string): SkillInstance {
  return step('bot', {
    platform: '{{var.botPlatform}}',
    chatIds: '{{var.chatId}}',
    message: `${X_POST_HEADER}\n\n${body}`,
    attachment: '{{post.image}}',
    attachmentType: 'auto',
    emitFailFlag: 'true',
  }, t(labelKey), outputKey);
}

/**
 * The board and the net score a PTT template watches, then the bot and the chat, as in the X
 * template. Not required: each arrives set to the template's default, so it is usable as added
 * and the recipient guard holds it until a chat is picked.
 */
function pttVariables(t: Translate, board: string, score: string): FlowVariable[] {
  return [
    { ...textVar('pttBoard', t, false), value: board, placeholder: board },
    { ...numberVar('pttScore', t, score), required: false, min: '1', max: '100' },
    { ...botPlatformVar(t), required: false },
    { ...chatVar(t), platformKey: 'botPlatform' },
  ];
}

function pttBoardStep(t: Translate): SkillInstance {
  return step('ptt_board', {
    ...DEFAULT_SKILL_CONFIG.ptt_board, board: '{{var.pttBoard}}', scoreMode: 'push', score: '{{var.pttScore}}',
  }, t('flow.templates.ptt.step.board'), 'ptt_1');
}

function pttMessage(t: Translate, message: string, attachment: string, labelKey: string, outputKey: string, preview = ''): SkillInstance {
  return step('bot', {
    platform: '{{var.botPlatform}}',
    chatIds: '{{var.chatId}}',
    message,
    attachment,
    attachmentType: 'auto',
    ...(preview ? { preview } : {}),
    emitFailFlag: 'true',
  }, t(labelKey), outputKey);
}

function lineChatVar(t: Translate): FlowVariable {
  return {
    key: 'lineChat',
    type: 'lineChat',
    label: t('flow.templates.var.lineChat.label'),
    question: t('flow.templates.var.lineChat.question'),
    hint: t('flow.templates.var.lineChat.hint'),
    value: '',
    required: true,
  };
}

function dailyCron(hour: number, minute = 0): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'daily',
    scheduleHour: hour,
    scheduleMinute: minute,
    repeatWithinDay: false,
    repeatEveryUnit: 'hours',
    repeatEveryValue: 1,
    endHour: 23,
    endMinute: 59,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

function timestamps(): { createdAt: string; updatedAt: string } {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
}

/**
 * Defaults for the selected-text templates, written as the flow hotkey recorder writes them:
 * Ctrl+Alt on Windows, Cmd+Option on macOS. They clash with nothing Yobi ships (its own two are
 * Alt+G and Alt+H / Cmd+Ctrl+G and Cmd+Ctrl+H). On Windows AltGr is Ctrl+Alt, so no letter here
 * types a character with AltGr on the German, French, Spanish, Nordic or Polish layouts: S would
 * swallow the Polish ś, and on macOS Cmd+Option+S is Save All in editors. R is for recap.
 */
const SELECTION_HOTKEYS = {
  translate: 'CommandOrControl+Alt+T',
  polish: 'CommandOrControl+Alt+P',
  summary: 'CommandOrControl+Alt+R',
} as const;

/**
 * Selected text in, AI result on the clipboard, one notification. The hotkey starts the flow even
 * with nothing selected, so an empty selection says so and ends the run before the AI step.
 * `stem` names the template's own strings: `flow.templates.<stem>.step.llm` / `.notify.title`.
 */
function selectionSteps(t: Translate, stem: string, prompt: string): SkillInstance[] {
  return [
    step('if', { left: '{{selection}}', operator: 'is_empty', right: '' }, t('flow.templates.selection.step.ifEmpty')),
    step('notify', {
      title: t('flow.templates.selection.notify.empty.title'),
      body: t('flow.templates.selection.notify.empty.body'),
    }, t('flow.templates.selection.step.tellEmpty')),
    step('stop', { value: '{{selection}}' }, t('flow.templates.selection.step.stopEmpty')),
    step('end_if', {}, t('flow.skill.end_if')),
    step('llm', llmConfig(prompt), t(`flow.templates.${stem}.step.llm`), 'llm_1'),
    step('clipboard', { action: 'write', text: '{{llm_1}}' }, t('flow.templates.selection.step.copy'), 'clip_1'),
    step('notify', { title: t(`flow.templates.${stem}.notify.title`), body: '{{llm_1}}' }, t('flow.templates.selection.step.notify')),
  ];
}

/**
 * The translation target, every language the chat's translator offers, in name order. The value is
 * the name the prompt uses ("Traditional Chinese as used in Taiwan"), so the step reads it as is.
 */
function targetLanguageVar(t: Translate, locale: string): FlowVariable {
  const options = sortedTranslateLanguages(locale)
    .map((tag) => ({ value: promptLanguageName(tag), label: languageDisplayName(tag, locale) }));
  // Not required: it arrives set to the UI language, so the template is usable as added.
  return { ...selectVar('targetLanguage', t, options, promptLanguageName(uiTargetLanguage(locale))), required: false };
}

interface SelectionTemplateSpec {
  key: string;
  /** The template's string stem: `flow.templates.<stem>`, `.desc`, `.step.llm`, `.notify.title`. */
  stem: string;
  hotkey: string;
  icon: LucideIcon;
  prompt: (locale: string) => string;
  variables?: (t: Translate, locale: string) => FlowVariable[];
  setupCount?: number;
}

function selectionTemplate(spec: SelectionTemplateSpec): FlowTemplate {
  const { key, stem, hotkey, icon, prompt, variables = () => [], setupCount = 0 } = spec;
  return {
    key,
    category: 'hotkey',
    titleKey: `flow.templates.${stem}`,
    descKey: `flow.templates.${stem}.desc`,
    primarySkill: 'llm',
    hue: 'pink',
    icon,
    hotkey,
    setupCount,
    build: (t, locale): FlowDefinition => {
      const vars = variables(t, locale);
      return {
        id: makeId(),
        name: t(`flow.templates.${stem}`),
        description: t(`flow.templates.${stem}.desc`),
        enabled: false,
        trigger: { type: 'hotkey', keys: hotkey },
        ...(vars.length > 0 ? { variables: vars } : {}),
        steps: selectionSteps(t, stem, prompt(locale)),
        ...timestamps(),
      };
    },
  };
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  selectionTemplate({
    key: 'sel_translate',
    stem: 'selTranslate',
    hotkey: SELECTION_HOTKEYS.translate,
    icon: Languages,
    prompt: selectionTranslatePrompt,
    variables: (t, locale) => [targetLanguageVar(t, locale)],
    setupCount: 1,
  }),
  selectionTemplate({
    key: 'sel_polish',
    stem: 'selPolish',
    hotkey: SELECTION_HOTKEYS.polish,
    icon: WandSparkles,
    prompt: selectionPolishPrompt,
  }),
  selectionTemplate({
    key: 'sel_summary',
    stem: 'selSummary',
    hotkey: SELECTION_HOTKEYS.summary,
    icon: ScrollText,
    prompt: selectionSummaryPrompt,
  }),
  {
    key: 'line_digest',
    category: 'push',
    titleKey: 'flow.templates.lineDigest',
    descKey: 'flow.templates.lineDigest.desc',
    primarySkill: 'line_read',
    hue: 'green',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.lineDigest'),
      description: t('flow.templates.lineDigest.desc'),
      enabled: false,
      trigger: dailyCron(9),
      variables: [lineChatVar(t), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('line_read', { chat: '{{var.lineChat}}', limit: '200', query: '', range: 'all', since: '', until: '', sinceLastRun: 'true' }, t('flow.templates.lineDigest.step.read'), 'line_1'),
        step('stop', { value: '{{line_1}}' }, t('flow.templates.step.stop_noNew')),
        step('llm', llmConfig(lineDigestPrompt(locale), { useMemory: 'true' }), t('flow.templates.lineDigest.step.llm'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'telegram_digest',
    category: 'push',
    titleKey: 'flow.templates.telegramDigest',
    descKey: 'flow.templates.telegramDigest.desc',
    primarySkill: 'telegram_read',
    hue: 'cyan',
    setupCount: 1,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.telegramDigest'),
      description: t('flow.templates.telegramDigest.desc'),
      enabled: false,
      trigger: dailyCron(9),
      variables: [chatVar(t)],
      steps: [
        recipientGuard(t),
        step('telegram_read', { chat: '', range: 'last24h' }, t('flow.templates.telegramDigest.step.read'), 'tg_1'),
        step('stop', { value: '{{tg_1}}' }, t('flow.templates.step.stop_noNew')),
        step('llm', llmConfig(telegramDigestPrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.telegramDigest.step.llm'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'line_alert',
    category: 'push',
    titleKey: 'flow.templates.lineAlert',
    descKey: 'flow.templates.lineAlert.desc',
    primarySkill: 'line_read',
    hue: 'green',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.lineAlert'),
      description: t('flow.templates.lineAlert.desc'),
      enabled: false,
      trigger: intervalCron(30),
      variables: [textVar('keyword', t), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('line_read', { chat: '', limit: '50', query: '{{var.keyword}}', range: 'all', since: '', until: '', sinceLastRun: 'true' }, t('flow.templates.lineAlert.step.read'), 'line_1'),
        step('stop', { value: '{{line_1}}' }, t('flow.templates.step.stop_noNew')),
        step('llm', llmConfig(lineAlertPrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.lineAlert.step.llm'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'line_weekly',
    category: 'push',
    titleKey: 'flow.templates.lineWeekly',
    descKey: 'flow.templates.lineWeekly.desc',
    primarySkill: 'line_read',
    hue: 'green',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.lineWeekly'),
      description: t('flow.templates.lineWeekly.desc'),
      enabled: false,
      trigger: singleWeekdayCron(5, 17),
      variables: [lineChatVar(t), chatVar(t)],
      steps: [
        recipientGuard(t),
        // A fixed seven days, NOT sinceLastRun: a week the PC was switched off would make the
        // next "weekly" review cover fourteen days. This is what the date range is for.
        step('line_read', { chat: '{{var.lineChat}}', limit: '400', query: '', range: 'last7d', since: '', until: '', sinceLastRun: 'false' }, t('flow.templates.lineWeekly.step.read'), 'line_1'),
        step('stop', { value: '{{line_1}}' }, t('flow.templates.lineWeekly.step.stop')),
        step('llm', llmConfig(lineWeeklyPrompt(locale)), t('flow.templates.lineWeekly.step.llm'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'cmd_line_topics',
    category: 'command',
    titleKey: 'flow.templates.lineTopics',
    descKey: 'flow.templates.lineTopics.desc',
    primarySkill: 'line_read',
    hue: 'green',
    command: 'linetopics',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      // Reads the owner's LINE chats: the owner and admins only, in a private chat.
      const { trigger, extraTriggers } = commandTriggers('linetopics', 'flow.templates.lineTopics.desc', t, 'admins');
      return {
        id: makeId(),
        name: t('flow.templates.lineTopics'),
        description: t('flow.templates.lineTopics.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('stop', { value: '{{input}}' }, t('flow.templates.lineTopics.step.needChat')),
          step('line_read', { chat: '{{input}}', limit: '100', query: '', range: 'all', since: '', until: '', sinceLastRun: 'false' }, t('flow.templates.lineTopics.step.read'), 'line_1'),
          step('stop', { value: '{{line_1}}' }, t('flow.templates.lineTopics.step.stop')),
          step('llm', llmConfig(lineTopicsPrompt(locale)), t('flow.templates.lineTopics.step.llm'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_line_today',
    category: 'command',
    titleKey: 'flow.templates.lineToday',
    descKey: 'flow.templates.lineToday.desc',
    primarySkill: 'line_read',
    hue: 'green',
    command: 'lineday',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      // Reads the owner's LINE chats: the owner and admins only, in a private chat.
      const { trigger, extraTriggers } = commandTriggers('lineday', 'flow.templates.lineToday.desc', t, 'admins');
      return {
        id: makeId(),
        name: t('flow.templates.lineToday'),
        description: t('flow.templates.lineToday.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('stop', { value: '{{input}}' }, t('flow.templates.lineToday.step.needChat')),
          step('line_read', { chat: '{{input}}', limit: '200', query: '', range: 'today', since: '', until: '', sinceLastRun: 'false' }, t('flow.templates.lineToday.step.read'), 'line_1'),
          // Deliberately no stop on an empty transcript: someone typed a command and is owed an
          // answer. The prompt turns a quiet day into one line instead of silence.
          step('llm', llmConfig(lineTodayPrompt(locale)), t('flow.templates.lineToday.step.llm'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'rss_telegram',
    category: 'push',
    titleKey: 'flow.templates.rss',
    descKey: 'flow.templates.rss.desc',
    primarySkill: 'rss',
    hue: 'orange',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.rss'),
      description: t('flow.templates.rss.desc'),
      enabled: false,
      trigger: weekdayCron(8),
      variables: [feedVar('feedUrl', t), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('rss', { url: '{{var.feedUrl}}' }, t('flow.templates.rss.step.feed'), 'rss_1'),
        step('stop', { value: '{{rss_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{rss_1}}', loopVar: 'item', limitIterations: 'true', maxIterations: '5' }, t('flow.templates.rss.step.loop'), 'loop_1'),
        step('browser', { url: '{{item.link}}', includeImage: 'true', emitFailFlag: 'true' }, t('flow.templates.rss.step.article'), 'browser_1'),
        ...skipEmpty('flow.templates.rss.step.skipEmpty', t, '{{browser_1}}', 'is_empty'),
        step('llm', llmConfig(articleBriefingPrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.rss.step.llm'), 'llm_1'),
        ...skipEmpty('flow.templates.rss.step.skipFailed', t, '{{llm_1.isFailed}}', 'equals', '1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '{{browser_1.image}}', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'youtube_subs',
    category: 'push',
    titleKey: 'flow.templates.ytSubs',
    descKey: 'flow.templates.ytSubs.desc',
    primarySkill: 'youtube_subs',
    hue: 'red',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.ytSubs'),
      description: t('flow.templates.ytSubs.desc'),
      enabled: false,
      trigger: intervalCron(10),
      variables: [textVar('channels', t, true, true), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('youtube_subs', { channels: '{{var.channels}}', perChannel: '3', skipShorts: 'true' }, t('flow.templates.ytSubs.step.subs'), 'ytsubs_1'),
        step('stop', { value: '{{ytsubs_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{ytsubs_1}}', loopVar: 'video', limitIterations: 'true', maxIterations: '5' }, t('flow.templates.ytSubs.step.loop'), 'loop_1'),
        step('youtube', { url: '{{video.link}}' }, t('flow.templates.ytSubs.step.transcript'), 'yt_1'),
        ...skipEmpty('flow.templates.ytSubs.step.skipNoCaption', t, '{{yt_1.transcript}}', 'is_empty'),
        step('llm', llmConfig(youtubeSummaryPrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.ytSubs.step.llm'), 'llm_1'),
        ...skipEmpty('flow.templates.rss.step.skipFailed', t, '{{llm_1.isFailed}}', 'equals', '1'),
        step('bot', { chatId: '{{var.chatId}}', message: '**[{{video.title}}]({{video.link}})**\n\n{{llm_1}}', attachment: '{{video.image}}', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'youtube_mp3',
    category: 'push',
    titleKey: 'flow.templates.ytMp3',
    descKey: 'flow.templates.ytMp3.desc',
    primarySkill: 'youtube_download',
    hue: 'red',
    setupCount: 2,
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.ytMp3'),
      description: t('flow.templates.ytMp3.desc'),
      enabled: false,
      trigger: dailyCron(7),
      variables: [textVar('channels', t, true, true), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('youtube_subs', { channels: '{{var.channels}}', perChannel: '3', skipShorts: 'true' }, t('flow.templates.ytSubs.step.subs'), 'ytsubs_1'),
        step('stop', { value: '{{ytsubs_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{ytsubs_1}}', loopVar: 'video', limitIterations: 'true', maxIterations: '5' }, t('flow.templates.ytSubs.step.loop'), 'loop_1'),
        // A schedule has no trigger platform, so `auto` would only save to this computer.
        step('youtube_download', { url: '{{video.link}}', quality: 'mp3', destination: 'telegram', folder: '', emitFailFlag: 'true' }, t('flow.templates.ytMp3.step.download'), 'dl_1'),
        ...skipEmpty('flow.templates.ytMp3.step.skipFailed', t, '{{dl_1.isFailed}}', 'equals', '1'),
        // Too long for one Telegram album: the file stays on this computer and the chat is told so.
        step('if', { left: '{{dl_1.savedLocally}}', operator: 'equals', right: '1' }, t('flow.templates.ytMp3.step.ifSaved')),
        step('bot', { chatId: '{{var.chatId}}', message: '**[{{video.title}}]({{video.link}})**\n\n{{dl_1.summary}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.ytMp3.step.sendSaved'), 'bot_saved'),
        step('continue', {}, t('flow.skill.continue')),
        step('end_if', {}, t('flow.skill.end_if')),
        step('bot', { chatId: '{{var.chatId}}', message: '**[{{video.title}}]({{video.link}})**', attachment: '{{dl_1}}', attachmentType: 'audio', emitFailFlag: 'true' }, t('flow.templates.ytMp3.step.sendAudio'), 'bot_1'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'x_watch',
    category: 'push',
    titleKey: 'flow.templates.xWatch',
    descKey: 'flow.templates.xWatch.desc',
    primarySkill: 'x_posts',
    hue: 'indigo',
    setupCount: 4,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.xWatch'),
      description: t('flow.templates.xWatch.desc'),
      enabled: false,
      // Half-hourly so a busy account's new posts are not missed between runs.
      trigger: intervalCron(30),
      variables: [
        { ...textVar('xAccounts', t, true, true), placeholder: '@nasa\n@github' },
        selectVar('xMode', t, [
          { value: 'explain', label: t('flow.templates.var.xMode.explain') },
          { value: 'plain', label: t('flow.templates.var.xMode.plain') },
        ], 'explain'),
        botPlatformVar(t),
        { ...chatVar(t), platformKey: 'botPlatform' },
      ],
      steps: [
        recipientGuard(t),
        step('x_posts', { accounts: '{{var.xAccounts}}', perAccount: '5' }, t('flow.templates.xWatch.step.posts'), 'xposts_1'),
        step('stop', { value: '{{xposts_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{xposts_1}}', loopVar: 'post', limitIterations: 'true', maxIterations: '10' }, t('flow.templates.xWatch.step.loop'), 'loop_1'),
        step('if', { left: '{{var.xMode}}', operator: 'equals', right: 'explain' }, t('flow.templates.xWatch.step.ifExplain')),
        step('llm', llmConfig(xPostExplainPrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.xWatch.step.llm'), 'llm_1'),
        step('if', { left: '{{llm_1.isFailed}}', operator: 'not_equals', right: '1' }, t('flow.templates.xWatch.step.ifExplained')),
        xPostMessage(t, '{{llm_1}}', 'flow.templates.xWatch.step.sendExplained', 'bot_1'),
        step('continue', {}, t('flow.skill.continue')),
        step('end_if', {}, t('flow.skill.end_if')),
        step('end_if', {}, t('flow.skill.end_if')),
        // The bare post, and the fallback when the explanation failed: the promise is the alert.
        xPostMessage(t, '{{post.text}}', 'flow.templates.xWatch.step.sendPost', 'bot_2'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'ptt_hot',
    category: 'push',
    titleKey: 'flow.templates.pttHot',
    descKey: 'flow.templates.pttHot.desc',
    primarySkill: 'ptt_board',
    hue: 'violet',
    setupCount: 4,
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.pttHot'),
      description: t('flow.templates.pttHot.desc'),
      enabled: false,
      // PTT caches its search pages for three minutes, so a tighter schedule reads the same page.
      trigger: intervalCron(10),
      variables: pttVariables(t, 'Gossiping', '80'),
      steps: [
        recipientGuard(t),
        pttBoardStep(t),
        step('stop', { value: '{{ptt_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{ptt_1}}', loopVar: 'post', limitIterations: 'true', maxIterations: '5' }, t('flow.templates.ptt.step.loop'), 'loop_1'),
        // The site's own forward: title, author, board, text, photos and the push tally.
        step('x_media', { input: '{{post.link}}', destination: '{{var.botPlatform}}', folder: '', reader: '', emitFailFlag: 'true' }, t('flow.templates.pttHot.step.read'), 'xm'),
        ...skipEmpty('flow.templates.ptt.step.skipUnread', t, '{{xm.isFailed}}', 'equals', '1'),
        step('if', { left: '{{xm.overflow}}', operator: 'is_true', right: '' }, t('flow.templates.pttHot.step.ifLong')),
        pttMessage(t, '{{xm.overflow}}', '', 'flow.templates.pttHot.step.sendText', 'bot_text'),
        step('end_if', {}, t('flow.skill.end_if')),
        pttMessage(t, '{{xm.caption}}', '{{xm}}', 'flow.templates.pttHot.step.send', 'bot_1', '{{xm.previews}}'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'ptt_analyze',
    category: 'push',
    titleKey: 'flow.templates.pttAnalyze',
    descKey: 'flow.templates.pttAnalyze.desc',
    primarySkill: 'ptt_board',
    hue: 'violet',
    setupCount: 4,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.pttAnalyze'),
      description: t('flow.templates.pttAnalyze.desc'),
      enabled: false,
      trigger: dailyCron(12),
      variables: pttVariables(t, 'Lifeismoney', '20'),
      steps: [
        recipientGuard(t),
        pttBoardStep(t),
        step('stop', { value: '{{ptt_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{ptt_1}}', loopVar: 'post', limitIterations: 'true', maxIterations: '5' }, t('flow.templates.ptt.step.loop'), 'loop_1'),
        // As many pushes as fit the analysis budget; past it the step samples them.
        step('x_thread', { url: '{{post.link}}', maxReplies: '1000', emitFailFlag: 'true' }, t('flow.templates.pttAnalyze.step.read'), 'xt'),
        ...skipEmpty('flow.templates.ptt.step.skipUnread', t, '{{xt.isFailed}}', 'equals', '1'),
        step('llm', llmConfig(pushesAnalyzePrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.pttAnalyze.step.llm'), 'llm_1'),
        ...skipEmpty('flow.templates.rss.step.skipFailed', t, '{{llm_1.isFailed}}', 'equals', '1'),
        // The title is the poster's text, so it stays out of link brackets it could close early.
        pttMessage(t, '**{{post.title}}**\n{{post.link}}\n\n{{llm_1}}', '', 'flow.templates.pttAnalyze.step.send', 'bot_1'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'morning_brief',
    category: 'push',
    titleKey: 'flow.templates.morningBrief',
    descKey: 'flow.templates.morningBrief.desc',
    primarySkill: 'weather',
    hue: 'yellow',
    icon: Sunrise,
    setupCount: 4,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.morningBrief'),
      description: t('flow.templates.morningBrief.desc'),
      enabled: false,
      trigger: weekdayCron(7),
      variables: [
        textVar('city', t, false),
        textVar('symbols', t, false),
        { ...textVar('fxPairs', t, false, true), placeholder: 'USD/TWD\nEUR/JPY\nGBP/USD' },
        chatVar(t),
      ],
      steps: [
        recipientGuard(t),
        ...whenSet('city', 'flow.templates.morningBrief.ifWeather', t,
          step('weather', { location: '{{var.city}}', units: 'metric' }, t('flow.templates.step.weather'), 'weather_1')),
        ...whenSet('symbols', 'flow.templates.morningBrief.ifStock', t,
          step('stock', { symbol: '{{var.symbols}}' }, t('flow.templates.step.stock'), 'stock_1')),
        ...whenSet('fxPairs', 'flow.templates.morningBrief.ifForex', t,
          step('js', { code: FX_LOOKUP_CODE }, t('flow.templates.step.forexLookup'), 'fx_1')),
        // Blank calendar = the only one there is. Without any (or with several) it fails soft and
        // the brief leaves the schedule out.
        step('calendar', { ...DEFAULT_SKILL_CONFIG.calendar, range: 'today', emitFailFlag: 'true' }, t('flow.templates.step.agenda'), 'agenda'),
        step('llm', llmConfig(morningBriefPrompt(locale)), t('flow.templates.step.brief'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'mail_digest',
    category: 'push',
    titleKey: 'flow.templates.mailDigest',
    descKey: 'flow.templates.mailDigest.desc',
    primarySkill: 'mail_fetch',
    hue: 'red',
    setupCount: 1,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.mailDigest'),
      description: t('flow.templates.mailDigest.desc'),
      enabled: false,
      trigger: dailyCron(8),
      variables: [chatVar(t)],
      steps: [
        recipientGuard(t),
        step('mail_fetch', { ...DEFAULT_SKILL_CONFIG.mail_fetch, limit: '20' }, t('flow.templates.step.mailNew'), 'mail_1'),
        step('stop', { value: '{{mail_1}}' }, t('flow.templates.step.stop_noNew')),
        step('llm', llmConfig(mailDigestPrompt(locale)), t('flow.templates.step.brief'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'mail_watch',
    category: 'push',
    titleKey: 'flow.templates.mailWatch',
    descKey: 'flow.templates.mailWatch.desc',
    primarySkill: 'mail_fetch',
    hue: 'red',
    setupCount: 3,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.mailWatch'),
      description: t('flow.templates.mailWatch.desc'),
      enabled: false,
      // Every five minutes, reporting each matching mail once: as good as instant for a person.
      trigger: intervalCron(5),
      variables: [textVar('mailFrom', t, false), textVar('mailKeywords', t, false), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('mail_fetch', {
          ...DEFAULT_SKILL_CONFIG.mail_fetch, from: '{{var.mailFrom}}', keywords: '{{var.mailKeywords}}', limit: '5',
        }, t('flow.templates.step.mailMatching'), 'mail_1'),
        step('stop', { value: '{{mail_1}}' }, t('flow.templates.step.stop_noNew')),
        step('llm', llmConfig(mailWatchPrompt(locale)), t('flow.templates.step.mailAnalyze'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'stock_watch',
    category: 'push',
    titleKey: 'flow.templates.stockWatch',
    descKey: 'flow.templates.stockWatch.desc',
    primarySkill: 'stock',
    hue: 'teal',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.stockWatch'),
      description: t('flow.templates.stockWatch.desc'),
      enabled: false,
      trigger: hourlyWeekdayCron(9, 16),
      variables: [textVar('symbols', t), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('stock', { symbol: '{{var.symbols}}' }, t('flow.templates.step.stock'), 'stock_1'),
        step('llm', llmConfig(stockWatchPrompt(locale)), t('flow.templates.step.brief'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'forex_alert',
    category: 'push',
    titleKey: 'flow.templates.forexAlert',
    descKey: 'flow.templates.forexAlert.desc',
    primarySkill: 'forex',
    hue: 'cyan',
    setupCount: 5,
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.forexAlert'),
      description: t('flow.templates.forexAlert.desc'),
      enabled: false,
      trigger: hourlyWeekdayCron(8, 23),
      variables: [
        selectVar('baseCurrency', t, currencyOptions(t), 'USD'),
        selectVar('targetCurrency', t, currencyOptions(t), 'TWD'),
        selectVar('direction', t, [
          { value: 'below', label: t('flow.templates.var.direction.below') },
          { value: 'above', label: t('flow.templates.var.direction.above') },
        ], 'below'),
        numberVar('targetPrice', t, ''),
        chatVar(t),
      ],
      steps: [
        recipientGuard(t),
        step('forex', {
          base: '{{var.baseCurrency}}',
          target: '{{var.targetCurrency}}',
          amount: '',
          precision: '4',
        }, t('flow.templates.step.forex'), 'forex_1'),
        step('js', { code: FOREX_GATE_CODE }, t('flow.templates.step.alertGate'), 'gate_1'),
        step('on_change', { value: '{{gate_1}}' }, t('flow.templates.step.onlyOnce'), 'changed_1'),
        step('stop', { value: '{{changed_1}}' }, t('flow.templates.step.stopUnderThreshold')),
        step('bot', { chatId: '{{var.chatId}}', message: t('flow.templates.forexAlert.message'), attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'invoice_draw',
    category: 'push',
    titleKey: 'flow.templates.invoiceDraw',
    descKey: 'flow.templates.invoiceDraw.desc',
    primarySkill: 'tw_invoice',
    hue: 'orange',
    setupCount: 1,
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.invoiceDraw'),
      description: t('flow.templates.invoiceDraw.desc'),
      enabled: false,
      // The draw is on the 25th of odd months and the list updates around 14:00 Taiwan time. The
      // schedule cannot say "odd months", so it runs on the 25th-27th of every month (a late list
      // is still caught) and `.newThisMonth` is blank unless the latest period was drawn this
      // month; on_change lets each period through once.
      trigger: monthlyCron([25, 26, 27], 15),
      variables: [chatVar(t)],
      steps: [
        recipientGuard(t),
        step('tw_invoice', { ...DEFAULT_SKILL_CONFIG.tw_invoice }, t('flow.templates.invoiceDraw.step.fetch'), 'invoice_1'),
        step('on_change', { value: '{{invoice_1.newThisMonth}}' }, t('flow.templates.invoiceDraw.step.onlyNew'), 'changed_1'),
        step('stop', { value: '{{changed_1}}' }, t('flow.templates.step.stop_noNew')),
        step('bot', { chatId: '{{var.chatId}}', message: '{{invoice_1.text}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('flow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'web_monitor',
    category: 'push',
    titleKey: 'flow.templates.webMonitor',
    descKey: 'flow.templates.webMonitor.desc',
    primarySkill: 'scraper',
    hue: 'blue',
    setupCount: 3,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('flow.templates.webMonitor'),
      description: t('flow.templates.webMonitor.desc'),
      enabled: false,
      trigger: weekdayCron(9),
      variables: [
        textVar('siteUrl', t),
        listSelectorVar('siteUrl', t),
        derivedSelectorVar('titleSelector', t),
        derivedSelectorVar('linkSelector', t),
        chatVar(t),
      ],
      steps: [
        recipientGuard(t),
        step('scraper', {
          url: '{{var.siteUrl}}',
          itemSelector: '{{var.itemSelector}}',
          titleSelector: '{{var.titleSelector}}',
          linkSelector: '{{var.linkSelector}}',
          maxItems: '5',
        }, t('flow.templates.webMonitor.step.scraper'), 'scraper_1'),
        step('stop', { value: '{{scraper_1}}' }, t('flow.templates.step.stop_noNew')),
        step('loop', { input: '{{scraper_1}}', loopVar: 'item', limitIterations: 'true', maxIterations: '5' }, t('flow.templates.webMonitor.step.loop'), 'loop_1'),
        step('browser', { url: '{{item.link}}', includeImage: 'true', emitFailFlag: 'true' }, t('flow.templates.webMonitor.step.browser'), 'browser_1'),
        ...skipEmpty('flow.templates.webMonitor.step.skipEmpty', t, '{{browser_1}}', 'is_empty'),
        step('llm', llmConfig(articleBriefingPrompt(locale), { emitFailFlag: 'true' }), t('flow.templates.webMonitor.step.llm'), 'llm_1'),
        ...skipEmpty('flow.templates.webMonitor.step.skipFailed', t, '{{llm_1.isFailed}}', 'equals', '1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '{{browser_1.image}}', attachmentType: 'auto', emitFailFlag: 'true' }, t('flow.templates.step.bot'), 'bot_1'),
        step('end_loop', {}, t('flow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'cmd_ask',
    category: 'command',
    titleKey: 'flow.templates.cmdAsk',
    descKey: 'flow.templates.cmdAsk.desc',
    primarySkill: 'llm',
    hue: 'violet',
    command: 'ask',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('ask', 'flow.templates.cmdAsk.desc', t);
      return {
        id: makeId(),
        name: t('flow.templates.cmdAsk'),
        description: t('flow.templates.cmdAsk.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('llm', llmConfig(askPrompt(locale)), t('flow.templates.step.answer'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_council',
    category: 'command',
    titleKey: 'flow.templates.cmdCouncil',
    descKey: 'flow.templates.cmdCouncil.desc',
    primarySkill: 'llm',
    hue: 'violet',
    // Not one answer but a comparison of three: the AI glyph alone reads as /ask.
    icon: Scale,
    command: 'council',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('council', 'flow.templates.cmdCouncil.desc', t);
      const memberPrompt = councilMemberPrompt(locale);
      // One after another (the browser AIs share one window). A signed-out member is marked
      // absent through its failure flag instead of failing the run; each step has its own
      // response timeout and a flow run has no overall cap, so four in a row fit.
      const members = COUNCIL_MEMBERS.map(({ key, provider }) => step(
        'llm',
        llmConfig(memberPrompt, { provider: PROVIDER_URLS[provider], emitFailFlag: 'true' }),
        t(`flow.templates.cmdCouncil.step.${key}`),
        key,
      ));
      return {
        id: makeId(),
        name: t('flow.templates.cmdCouncil'),
        description: t('flow.templates.cmdCouncil.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('stop', { value: '{{input}}' }, t('flow.templates.cmdCouncil.step.needQuestion')),
          ...members,
          step('llm', llmConfig(councilSynthesisPrompt(locale)), t('flow.templates.cmdCouncil.step.compare'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_summarize',
    category: 'command',
    titleKey: 'flow.templates.cmdSum',
    descKey: 'flow.templates.cmdSum.desc',
    primarySkill: 'browser',
    hue: 'blue',
    command: 'sum',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('sum', 'flow.templates.cmdSum.desc', t);
      return {
        id: makeId(),
        name: t('flow.templates.cmdSum'),
        description: t('flow.templates.cmdSum.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('browser', { url: '{{input}}', includeImage: 'false', emitFailFlag: 'false' }, t('flow.templates.step.fetchPage'), 'browser_1'),
          step('llm', llmConfig(summarizeUrlPrompt(locale)), t('flow.templates.step.summarize'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_youtube',
    category: 'command',
    titleKey: 'flow.templates.cmdYt',
    descKey: 'flow.templates.cmdYt.desc',
    primarySkill: 'youtube',
    hue: 'red',
    command: 'yt',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('yt', 'flow.templates.cmdYt.desc', t);
      return {
        id: makeId(),
        name: t('flow.templates.cmdYt'),
        description: t('flow.templates.cmdYt.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('youtube', { url: '{{input}}' }, t('flow.templates.ytSubs.step.transcript'), 'yt_1'),
          step('llm', llmConfig(ytCommandPrompt(locale)), t('flow.templates.step.summarize'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_stock',
    category: 'command',
    titleKey: 'flow.templates.cmdStock',
    descKey: 'flow.templates.cmdStock.desc',
    primarySkill: 'stock',
    hue: 'teal',
    command: 'stock',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('stock', 'flow.templates.cmdStock.desc', t);
      return {
        id: makeId(),
        name: t('flow.templates.cmdStock'),
        description: t('flow.templates.cmdStock.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('stock', { symbol: '{{input}}' }, t('flow.templates.step.stock'), 'stock_1'),
          step('llm', llmConfig(stockQuotePrompt(locale)), t('flow.templates.step.explain'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_markdown_doc',
    category: 'command',
    titleKey: 'flow.templates.cmdMd',
    descKey: 'flow.templates.cmdMd.desc',
    primarySkill: 'share',
    hue: 'indigo',
    icon: FileOutput,
    command: 'md',
    setupCount: 0,
    build: (t): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('md', 'flow.templates.cmdMd.desc', t);
      return {
        id: makeId(),
        name: t('flow.templates.cmdMd'),
        description: t('flow.templates.cmdMd.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('js', { code: MD_FORMAT_CODE }, t('flow.templates.md.step.format'), 'fmt'),
          step('js', { code: MD_BODY_CODE }, t('flow.templates.md.step.body'), 'body'),
          step('share', {
            content: '{{body}}',
            format: '{{fmt}}',
            zip: 'false',
            title: '',
            filename: '',
            palette: 'linen',
            backgroundStyle: 'gradient',
            width: '1200',
            expire: '1week',
            burnAfterReading: 'false',
            emitFailFlag: 'false',
          }, t('flow.templates.md.step.render'), 'doc'),
          step('text', { text: '{{doc.summary}}\n{{doc}}' }, t('flow.templates.md.step.reply'), 'reply'),
          step('bot', {
            chatId: '{{bot.triggerChatId}}',
            message: '{{reply}}',
            attachment: '{{file}}',
            attachmentType: 'auto',
            emitFailFlag: 'true',
          }, t('flow.templates.step.reply'), 'bot_1'),
        ],
        ...timestamps(),
      };
    },
  },
];
