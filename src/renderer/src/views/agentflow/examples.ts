import { buildFlowCronExpression } from '../../../../shared/flowSchedule';
import type { FlowDefinition, FlowVariable, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';
import {
  askPrompt,
  morningBriefPrompt,
  rssBriefingPrompt,
  stockQuotePrompt,
  stockWatchPrompt,
  summarizeUrlPrompt,
  webMonitorPrompt,
  youtubeSummaryPrompt,
  ytCommandPrompt,
} from './templatePrompts';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Translate = (key: string) => string;

// Two shelves in the gallery: flows that push to you on a schedule, and flows you
// invoke by name. It is the split that tells a browsing user which half they want.
export type TemplateCategory = 'push' | 'command';

export interface FlowTemplate {
  key: string;
  category: TemplateCategory;
  titleKey: string;
  descKey: string;
  primarySkill: SkillType;
  /** Slash command a command-category template answers, shown as a chip on its card. */
  command?: string;
  /** Number of fields the user can fill in — drives the "N to set up" badge. */
  setupCount: number;
  // `locale` pins the reply language of the seeded LLM prompts at creation time.
  build: (t: Translate, locale: string) => FlowDefinition;
}

// --- shared builders -------------------------------------------------------

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
  return {
    type: 'cron',
    scheduleMode: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    scheduleHour: hour,
    scheduleMinute: minute,
    repeatWithinDay: false,
    repeatEveryUnit: 'minutes',
    repeatEveryValue: 60,
    endHour: 23,
    endMinute: 59,
    cronExpression: `${minute} ${hour} * * 1-5`,
  };
}

// Poll round the clock on a fixed interval. For a feed that can publish at any
// hour, a fixed daily time would sit on a new item for most of a day; polling is
// cheap here because a run with nothing new stops at the `stop` step. The cron
// string comes from the shared builder so it cannot drift from the fields.
function intervalCron(value: number, unit: 'minutes' | 'hours' = 'minutes'): TriggerConfig {
  const trigger: TriggerConfig = {
    type: 'cron',
    scheduleMode: 'interval',
    intervalUnit: unit,
    intervalValue: value,
  };
  return { ...trigger, cronExpression: buildFlowCronExpression(trigger) };
}

// Every hour on the hour within a weekday window. This is the app's own
// repeat-within-day model: the cron fires each minute and shouldExecuteCronTriggerNow
// gates it to the window + interval, so the cronExpression is the canonical
// '* * * * *' (matching what normalizeCronTrigger would regenerate — no drift).
function hourlyWeekdayCron(startHour: number, endHour: number): TriggerConfig {
  return {
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
    cronExpression: '* * * * *',
  };
}

// A command served on both the Telegram/LINE bot and the in-app chat box, so the
// same slash command works wherever the user types it.
function commandTriggers(command: string, descKey: string, t: Translate): { trigger: TriggerConfig; extraTriggers: TriggerConfig[] } {
  return {
    trigger: { type: 'bot', botCommand: command, botCommandDescription: t(descKey), botInputVariable: 'input' },
    extraTriggers: [{ type: 'chat', chatCommand: command, chatCommandDescription: t(descKey), chatInputVariable: 'input' }],
  };
}

// The bot step that closes a command flow. On a bot-triggered run it delivers to
// whoever sent the command; on an in-app chat run {{bot.triggerChatId}} is empty,
// so it fails soft (emitFailFlag) and the chat surface shows the llm output — the
// flow's finalOutput — instead. One flow, both surfaces.
function replyStep(t: Translate): SkillInstance {
  return step('bot', {
    chatId: '{{bot.triggerChatId}}',
    message: '{{llm_1}}',
    attachment: '',
    attachmentType: 'auto',
    emitFailFlag: 'true',
  }, t('agentflow.templates.step.reply'), 'bot_1');
}

// The recipient is optional: a bot isn't set up on every machine, so a template
// must be addable without one. The push templates pair this with a leading
// recipientGuard so a flow enabled without a recipient simply stops early rather
// than doing work it can't deliver.
function chatVar(t: Translate): FlowVariable {
  return {
    key: 'chatId',
    type: 'chat',
    label: t('agentflow.templates.var.chatId.label'),
    question: t('agentflow.templates.var.chatId.question'),
    hint: t('agentflow.templates.var.chatId.hint'),
    value: '',
  };
}

// First step of every push template: stop before doing anything if no recipient
// is set. stop throws on an empty value, so a blank {{var.chatId}} halts the flow
// before it fetches (and, for the seen-cached feeds, before it marks anything
// read — so nothing is lost). A set recipient passes straight through.
function recipientGuard(t: Translate): SkillInstance {
  return step('stop', { value: '{{var.chatId}}' }, t('agentflow.templates.step.needRecipient'), '');
}

// Look up any number of user-defined "A/B" currency pairs — both sides free, not
// locked to a USD base. Reads the multiline list from vars['var.fxPairs'] (safe:
// no interpolation into JS source), fetches one rate table per distinct base, and
// returns one "1 A = r B" line per pair for the brief to format. A JS step is the
// right tool here because the forex skill does a single fixed pair per call.
// No backslash escapes in this source (String.fromCharCode(10) for the newline,
// a character-class for the separator) — a "\\n" would survive the template's
// interpolation as a literal and break the split.
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

function textVar(key: string, t: Translate, required = true, multiline = false): FlowVariable {
  return {
    key,
    type: 'text',
    label: t(`agentflow.templates.var.${key}.label`),
    question: t(`agentflow.templates.var.${key}.question`),
    hint: t(`agentflow.templates.var.${key}.hint`),
    value: '',
    required,
    ...(multiline ? { multiline: true } : {}),
  };
}

function numberVar(key: string, t: Translate, value: string): FlowVariable {
  return {
    key,
    type: 'number',
    label: t(`agentflow.templates.var.${key}.label`),
    question: t(`agentflow.templates.var.${key}.question`),
    hint: t(`agentflow.templates.var.${key}.hint`),
    value,
    required: true,
    min: '0',
  };
}

function skipEmpty(condKey: string, t: Translate, left: string, operator: string, right = ''): SkillInstance[] {
  return [
    step('if', { left, operator, right }, t(condKey)),
    step('continue', {}, t('agentflow.skill.continue')),
    step('end_if', {}, t('agentflow.skill.end_if')),
  ];
}

// Wrap steps so they run only when a variable is filled in. A blank variable is
// falsy (is_true is false on ''), so the block is skipped — which is how an
// optional section (skip the weather if no city was given) avoids fetching "".
function whenSet(varKey: string, labelKey: string, t: Translate, ...inner: SkillInstance[]): SkillInstance[] {
  return [
    step('if', { left: `{{var.${varKey}}}`, operator: 'is_true', right: '' }, t(labelKey)),
    ...inner,
    step('end_if', {}, t('agentflow.skill.end_if')),
  ];
}

function timestamps(): { createdAt: string; updatedAt: string } {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
}

// --- templates -------------------------------------------------------------

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'rss_telegram',
    category: 'push',
    titleKey: 'agentflow.templates.rss',
    descKey: 'agentflow.templates.rss.desc',
    primarySkill: 'rss',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('agentflow.templates.rss'),
      description: t('agentflow.templates.rss.desc'),
      enabled: false,
      trigger: weekdayCron(8),
      variables: [textVar('feedUrl', t), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('rss', { url: '{{var.feedUrl}}', cacheDays: '3', checkpoint: '', lastLinks: '' }, t('agentflow.templates.rss.step.feed'), 'rss_1'),
        step('stop', { value: '{{rss_1}}' }, t('agentflow.templates.step.stop_noNew'), 'stop_1'),
        // One article per iteration: one LLM call sees one article (never five
        // spliced past the provider's input cap), one message carries one
        // briefing (never five past Telegram's 4096-char cap), and each gets its
        // own cover image instead of the first article's.
        step('loop', { input: '{{rss_1}}', loopVar: 'item', limitIterations: 'true', maxIterations: '5' }, t('agentflow.templates.rss.step.loop'), 'loop_1'),
        // Without emitFailFlag a dead link throws, taking the whole run down —
        // including the articles the feed's checkpoint already marked as seen,
        // which are then gone for good. It fails soft into an empty output, which
        // the guard below turns into a skip.
        step('browser', { url: '{{item.link}}', includeImage: 'true', emitFailFlag: 'true' }, t('agentflow.templates.rss.step.article'), 'browser_1'),
        ...skipEmpty('agentflow.templates.rss.step.skipEmpty', t, '{{browser_1}}', 'is_empty'),
        step('llm', llmConfig(rssBriefingPrompt(locale), { emitFailFlag: 'true' }), t('agentflow.templates.rss.step.llm'), 'llm_1'),
        ...skipEmpty('agentflow.templates.rss.step.skipFailed', t, '{{llm_1.isFailed}}', 'equals', '1'),
        // Fail soft on the send too: the feed already marked every article seen,
        // so a transient Telegram error on article 3 must not abort the loop and
        // strand articles 4-5 (gone for good). Mirrors the youtube_subs template.
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '{{browser_1.image}}', attachmentType: 'auto', emitFailFlag: 'true' }, t('agentflow.templates.step.bot'), 'bot_1'),
        step('end_loop', {}, t('agentflow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'youtube_subs',
    category: 'push',
    titleKey: 'agentflow.templates.ytSubs',
    descKey: 'agentflow.templates.ytSubs.desc',
    primarySkill: 'youtube_subs',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('agentflow.templates.ytSubs'),
      description: t('agentflow.templates.ytSubs.desc'),
      enabled: false,
      trigger: intervalCron(10),
      variables: [textVar('channels', t, true, true), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('youtube_subs', { channels: '{{var.channels}}', perChannel: '3', skipShorts: 'true', cacheDays: '3' }, t('agentflow.templates.ytSubs.step.subs'), 'ytsubs_1'),
        step('stop', { value: '{{ytsubs_1}}' }, t('agentflow.templates.step.stop_noNew'), 'stop_1'),
        step('loop', { input: '{{ytsubs_1}}', loopVar: 'video', limitIterations: 'true', maxIterations: '5' }, t('agentflow.templates.ytSubs.step.loop'), 'loop_1'),
        step('youtube', { url: '{{video.link}}' }, t('agentflow.templates.ytSubs.step.transcript'), 'yt_1'),
        ...skipEmpty('agentflow.templates.ytSubs.step.skipNoCaption', t, '{{yt_1.transcript}}', 'is_empty'),
        // youtube_subs marks every emitted video as seen at fetch time, so a
        // transient failure on video 3 must not abort the run and strand videos
        // 4 and 5 — they would be cached as seen and gone for good. Fail soft and
        // skip the one, exactly as the RSS template does.
        step('llm', llmConfig(youtubeSummaryPrompt(locale), { emitFailFlag: 'true' }), t('agentflow.templates.ytSubs.step.llm'), 'llm_1'),
        ...skipEmpty('agentflow.templates.rss.step.skipFailed', t, '{{llm_1.isFailed}}', 'equals', '1'),
        step('bot', { chatId: '{{var.chatId}}', message: '**[{{video.title}}]({{video.link}})**\n\n{{llm_1}}', attachment: '{{video.image}}', attachmentType: 'auto', emitFailFlag: 'true' }, t('agentflow.templates.step.bot'), 'bot_1'),
        step('end_loop', {}, t('agentflow.skill.end_loop')),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'morning_brief',
    category: 'push',
    titleKey: 'agentflow.templates.morningBrief',
    descKey: 'agentflow.templates.morningBrief.desc',
    primarySkill: 'weather',
    // Everything is optional — pick the sections you want and a recipient.
    setupCount: 4,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('agentflow.templates.morningBrief'),
      description: t('agentflow.templates.morningBrief.desc'),
      enabled: false,
      trigger: weekdayCron(7),
      // Weather, stocks and the rate are each optional — fill the parts you want
      // in the brief and leave the rest blank. Each section is guarded by an `if`
      // on its variable, so a blank one is skipped rather than fetching "" (which
      // for weather is an outright "location not found" error).
      variables: [
        textVar('city', t, false),
        textVar('symbols', t, false),
        { ...textVar('fxPairs', t, false, true), placeholder: 'USD/TWD\nEUR/JPY\nGBP/USD' },
        chatVar(t),
      ],
      steps: [
        recipientGuard(t),
        ...whenSet('city', 'agentflow.templates.morningBrief.ifWeather', t,
          step('weather', { location: '{{var.city}}', units: 'metric' }, t('agentflow.templates.step.weather'), 'weather_1')),
        ...whenSet('symbols', 'agentflow.templates.morningBrief.ifStock', t,
          step('stock', { symbol: '{{var.symbols}}' }, t('agentflow.templates.step.stock'), 'stock_1')),
        ...whenSet('fxPairs', 'agentflow.templates.morningBrief.ifForex', t,
          step('js', { code: FX_LOOKUP_CODE }, t('agentflow.templates.step.forexLookup'), 'fx_1')),
        step('llm', llmConfig(morningBriefPrompt(locale)), t('agentflow.templates.step.brief'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('agentflow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'stock_watch',
    category: 'push',
    titleKey: 'agentflow.templates.stockWatch',
    descKey: 'agentflow.templates.stockWatch.desc',
    primarySkill: 'stock',
    setupCount: 2,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('agentflow.templates.stockWatch'),
      description: t('agentflow.templates.stockWatch.desc'),
      enabled: false,
      // A periodic watch, not a threshold alert. It reports where the stocks are
      // each hour through the trading day; a true "ping me only when it moves a
      // lot, once" alert needs a "have I already alerted?" memory the flow engine
      // does not have yet, and without it a periodic threshold check re-notifies
      // every hour it stays breached. Hourly reporting is spam-free by design —
      // the update IS the point. Times are local; retune the window to your market.
      trigger: hourlyWeekdayCron(9, 16),
      variables: [textVar('symbols', t), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('stock', { symbol: '{{var.symbols}}' }, t('agentflow.templates.step.stock'), 'stock_1'),
        step('llm', llmConfig(stockWatchPrompt(locale)), t('agentflow.templates.step.brief'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('agentflow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'forex_alert',
    category: 'push',
    titleKey: 'agentflow.templates.forexAlert',
    descKey: 'agentflow.templates.forexAlert.desc',
    primarySkill: 'forex',
    setupCount: 3,
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: t('agentflow.templates.forexAlert'),
      description: t('agentflow.templates.forexAlert.desc'),
      enabled: false,
      trigger: weekdayCron(9),
      variables: [textVar('targetCurrency', t), numberVar('targetPrice', t, ''), chatVar(t)],
      steps: [
        recipientGuard(t),
        step('forex', { base: 'USD', target: '{{var.targetCurrency}}', amount: '', precision: '4' }, t('agentflow.templates.step.forex'), 'forex_1'),
        // Fires when the rate reaches or passes the target (rising). Edit the js to
        // "<=" for a falling alert.
        step('js', { code: 'const r = parseFloat("{{forex_1.rate}}");\nconst t = parseFloat("{{var.targetPrice}}");\nreturn (isFinite(r) && isFinite(t) && r >= t) ? "hit" : "";' }, t('agentflow.templates.step.alertGate'), 'gate_1'),
        step('stop', { value: '{{gate_1}}' }, t('agentflow.templates.step.stopUnderThreshold'), 'stop_1'),
        step('bot', { chatId: '{{var.chatId}}', message: t('agentflow.templates.forexAlert.message'), attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('agentflow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'web_monitor',
    category: 'push',
    titleKey: 'agentflow.templates.webMonitor',
    descKey: 'agentflow.templates.webMonitor.desc',
    primarySkill: 'scraper',
    // siteUrl + item selector; title/link selectors and the recipient are optional.
    setupCount: 5,
    build: (t, locale): FlowDefinition => ({
      id: makeId(),
      name: t('agentflow.templates.webMonitor'),
      description: t('agentflow.templates.webMonitor.desc'),
      enabled: false,
      trigger: weekdayCron(9),
      // This one genuinely needs CSS selectors — there is no way to make "which
      // part of the page is a row?" a zero-typing question. It is marked advanced
      // in its description rather than pretending to be effortless.
      variables: [
        textVar('siteUrl', t),
        textVar('itemSelector', t),
        textVar('titleSelector', t, false),
        textVar('linkSelector', t, false),
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
          cacheDays: '3',
        }, t('agentflow.templates.webMonitor.step.scraper'), 'scraper_1'),
        step('stop', { value: '{{scraper_1}}' }, t('agentflow.templates.step.stop_noNew'), 'stop_1'),
        step('llm', llmConfig(webMonitorPrompt(locale)), t('agentflow.templates.webMonitor.step.llm'), 'llm_1'),
        step('bot', { chatId: '{{var.chatId}}', message: '{{llm_1}}', attachment: '', attachmentType: 'auto', emitFailFlag: 'false' }, t('agentflow.templates.step.bot'), 'bot_1'),
      ],
      ...timestamps(),
    }),
  },
  {
    key: 'cmd_ask',
    category: 'command',
    titleKey: 'agentflow.templates.cmdAsk',
    descKey: 'agentflow.templates.cmdAsk.desc',
    primarySkill: 'llm',
    command: 'ask',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('ask', 'agentflow.templates.cmdAsk.desc', t);
      return {
        id: makeId(),
        name: t('agentflow.templates.cmdAsk'),
        description: t('agentflow.templates.cmdAsk.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('llm', llmConfig(askPrompt(locale)), t('agentflow.templates.step.answer'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_summarize',
    category: 'command',
    titleKey: 'agentflow.templates.cmdSum',
    descKey: 'agentflow.templates.cmdSum.desc',
    primarySkill: 'browser',
    command: 'sum',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('sum', 'agentflow.templates.cmdSum.desc', t);
      return {
        id: makeId(),
        name: t('agentflow.templates.cmdSum'),
        description: t('agentflow.templates.cmdSum.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('browser', { url: '{{input}}', includeImage: 'false', emitFailFlag: 'false' }, t('agentflow.templates.step.fetchPage'), 'browser_1'),
          step('llm', llmConfig(summarizeUrlPrompt(locale)), t('agentflow.templates.step.summarize'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_youtube',
    category: 'command',
    titleKey: 'agentflow.templates.cmdYt',
    descKey: 'agentflow.templates.cmdYt.desc',
    primarySkill: 'youtube',
    command: 'yt',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('yt', 'agentflow.templates.cmdYt.desc', t);
      return {
        id: makeId(),
        name: t('agentflow.templates.cmdYt'),
        description: t('agentflow.templates.cmdYt.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('youtube', { url: '{{input}}' }, t('agentflow.templates.ytSubs.step.transcript'), 'yt_1'),
          step('llm', llmConfig(ytCommandPrompt(locale)), t('agentflow.templates.step.summarize'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
  {
    key: 'cmd_stock',
    category: 'command',
    titleKey: 'agentflow.templates.cmdStock',
    descKey: 'agentflow.templates.cmdStock.desc',
    primarySkill: 'stock',
    command: 'stock',
    setupCount: 0,
    build: (t, locale): FlowDefinition => {
      const { trigger, extraTriggers } = commandTriggers('stock', 'agentflow.templates.cmdStock.desc', t);
      return {
        id: makeId(),
        name: t('agentflow.templates.cmdStock'),
        description: t('agentflow.templates.cmdStock.desc'),
        enabled: false,
        trigger,
        extraTriggers,
        steps: [
          step('stock', { symbol: '{{input}}' }, t('agentflow.templates.step.stock'), 'stock_1'),
          step('llm', llmConfig(stockQuotePrompt(locale)), t('agentflow.templates.step.explain'), 'llm_1'),
          replyStep(t),
        ],
        ...timestamps(),
      };
    },
  },
];
