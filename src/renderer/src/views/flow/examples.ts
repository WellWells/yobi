import { FileOutput, Sunrise, type LucideIcon } from 'lucide-react';
import { buildFlowCronExpression } from '../../../../shared/flowSchedule';
import { COMMON_CURRENCIES } from '../../../../shared/currencies';
import type { FlowDefinition, FlowVariable, FlowVariableOption, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';
import {
  articleBriefingPrompt,
  askPrompt,
  lineAlertPrompt,
  lineDigestPrompt,
  lineTodayPrompt,
  lineTopicsPrompt,
  lineWeeklyPrompt,
  mapReviewsPrompt,
  morningBriefPrompt,
  stockQuotePrompt,
  stockWatchPrompt,
  summarizeUrlPrompt,
  youtubeSummaryPrompt,
  ytCommandPrompt,
} from './templatePrompts';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Translate = (key: string) => string;

export type TemplateCategory = 'push' | 'command';

/**
 * Gallery identity colour. It answers "what is this template about", which is a different
 * question from `skillHue()`'s "what does this step do" — nearly every template starts by
 * fetching something, so the skill categories collapsed fifteen of seventeen tiles onto one
 * colour. Templates over the same source share a hue on purpose (the five LINE ones).
 *
 * `gray` and `dark` are deliberately absent: their `-light` value is darker than the tile
 * on Yobi's dark themes, which turns the icon chip into a hole.
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
  setupCount: number;
  build: (t: Translate, locale: string) => FlowDefinition;
}

function step(type: SkillType, config: Record<string, string>, label: string, outputKey = ''): SkillInstance {
  return { id: makeId(), type, label, config, outputKey };
}

function llmConfig(prompt: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    prompt,
    provider: 'https://gemini.google.com/',
    saveToHistory: 'false',
    exportFormat: '',
    exportTitle: '',
    exportFileName: '',
    exportShowProvider: 'false',
    exportShowTimestamp: 'false',
    ...extra,
  };
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

function commandTriggers(command: string, descKey: string, t: Translate): { trigger: TriggerConfig; extraTriggers: TriggerConfig[] } {
  return {
    trigger: { type: 'bot', botCommand: command, botCommandDescription: t(descKey), botInputVariable: 'input' },
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

export const FLOW_TEMPLATES: FlowTemplate[] = [
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
      const { trigger, extraTriggers } = commandTriggers('linetopics', 'flow.templates.lineTopics.desc', t);
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
      const { trigger, extraTriggers } = commandTriggers('lineday', 'flow.templates.lineToday.desc', t);
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
        step('llm', llmConfig(morningBriefPrompt(locale)), t('flow.templates.step.brief'), 'llm_1'),
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
    key: 'cmd_map_reviews',
    category: 'command',
    titleKey: 'flow.templates.cmdMapReviews',
    descKey: 'flow.templates.cmdMapReviews.desc',
    primarySkill: 'gmap_reviews',
    hue: 'pink',
    command: 'gmr',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('gmr', 'flow.templates.cmdMapReviews.desc', t);
      return {
        id: makeId(),
        name: t('flow.templates.cmdMapReviews'),
        description: t('flow.templates.cmdMapReviews.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('gmap_reviews', { url: '{{input}}', sort: 'mixed', count: '100' }, t('flow.templates.step.fetchReviews'), 'gmap_1'),
          step('llm', llmConfig(mapReviewsPrompt({
            place: '{{gmap_1.place}}',
            reviews: '{{gmap_1}}',
            rating: '{{gmap_1.rating}}',
            total: '{{gmap_1.total}}',
            positive: '{{gmap_1.positive}}',
            distribution: '{{gmap_1.distribution}}',
            verdict: '{{gmap_1.verdict}}',
          }, locale)), t('flow.templates.step.analyzeReviews'), 'llm_1'),
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
