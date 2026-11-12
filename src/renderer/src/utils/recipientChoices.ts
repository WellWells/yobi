import { fillTemplate } from '../../../shared/fillTemplate';
import { isRecipientId, namesEveryone, namesSelf, splitTargets } from '../../../shared/botRecipients';
import type { BotPlatform, FlowVariable } from '../../../shared/types';

type Translate = (key: string) => string;

export interface RecipientOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RecipientOptionGroup {
  group: string;
  items: RecipientOption[];
}

export type RecipientOptions = Array<RecipientOption | RecipientOptionGroup>;

export const TRIGGER_CHAT_TOKEN = '{{bot.triggerChatId}}';
const VARIABLE_RE = /^\{\{\s*var\.([^}\s]+)\s*\}\}$/;
const TEMPLATE_RE = /\{\{[^}]+\}\}/;

/** A bot step's recipient field, split the way the executor splits it, each value once. */
export function recipientTokens(value: string): string[] {
  return [...new Set(splitTargets(value))];
}

/** Every value the options offer. */
export function optionValues(options: RecipientOptions): Set<string> {
  return new Set(options.flatMap((option) => ('group' in option ? option.items.map((item) => item.value) : [option.value])));
}

export interface OtherRecipientsContext {
  platform: BotPlatform | 'auto';
  t: Translate;
  /** The bot step offers the triggering chat and the flow's chat settings; the setup wizard does not. */
  offerStepChoices?: boolean;
  variables?: readonly FlowVariable[];
  /** Names for saved ids the lists do not offer (a former Telegram contact). */
  names?: ReadonlyMap<string, string>;
  /** The lists are still loading, so a saved id is not yet "not found". */
  loading?: boolean;
}

function variableLabel(key: string, ctx: OtherRecipientsContext): string {
  const variable = ctx.variables?.find((item) => item.key === key);
  return fillTemplate(ctx.t('flow.recipient.variable'), { name: variable?.label.trim() || key });
}

/**
 * The picker's "Other" group: what no chat list offers but the step can still send to — the chat
 * that started the flow, the flow's chat settings, and whatever the field already holds that the
 * lists do not have (a word like "me", a variable, a name, an id this computer does not know). Every
 * saved value stays a named choice, so the field never needs to show a raw id and picking never
 * drops what was there.
 */
export function withOtherRecipients(
  base: RecipientOptions,
  tokens: readonly string[],
  ctx: OtherRecipientsContext,
): RecipientOptions {
  const { items } = otherRecipients(base, tokens, ctx);
  return items.length > 0 ? [...base, { group: ctx.t('flow.recipient.other'), items }] : base;
}

/**
 * How many saved recipients no list of this platform offers (the "清單外的聊天 N" ones): after
 * the platform is switched, the ids picked on the old one land here and would not be delivered.
 */
export function unlistedRecipientCount(
  base: RecipientOptions,
  tokens: readonly string[],
  ctx: OtherRecipientsContext,
): number {
  return otherRecipients(base, tokens, ctx).unlisted;
}

function otherRecipients(
  base: RecipientOptions,
  tokens: readonly string[],
  ctx: OtherRecipientsContext,
): { items: RecipientOption[]; unlisted: number } {
  const { t } = ctx;
  const seen = optionValues(base);
  const items: RecipientOption[] = [];
  const add = (value: string, label: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    items.push({ value, label });
  };
  if (ctx.offerStepChoices) {
    add(TRIGGER_CHAT_TOKEN, t('flow.recipient.triggerChat'));
    for (const variable of ctx.variables ?? []) {
      if (variable.type === 'chat') add(`{{var.${variable.key}}}`, variableLabel(variable.key, ctx));
    }
  }
  const idPlatform: BotPlatform = ctx.platform === 'auto' ? 'telegram' : ctx.platform;
  let missing = 0;
  for (const token of tokens) {
    if (seen.has(token)) continue;
    const variable = VARIABLE_RE.exec(token);
    if (token === TRIGGER_CHAT_TOKEN) add(token, t('flow.recipient.triggerChat'));
    else if (variable) add(token, variableLabel(variable[1]!, ctx));
    else if (TEMPLATE_RE.test(token)) add(token, token);
    else if (namesSelf(token)) add(token, t('flow.recipient.self'));
    else if (namesEveryone(token)) add(token, t('flow.recipient.everyone'));
    else if (isRecipientId(token, idPlatform)) {
      const name = ctx.names?.get(token);
      if (name) add(token, name);
      else if (ctx.loading) add(token, t('flow.recipient.loadingChat'));
      else add(token, fillTemplate(t('flow.recipient.unlistedChat'), { n: String(++missing) }));
    } else add(token, token);
  }
  return { items, unlisted: missing };
}

/**
 * What is typed in the picker's search and matches no choice becomes one more choice ("Add …"):
 * a name the run resolves, or a chat no list has (a Discord or Slack channel) — the way in a text
 * field would be, without showing what the step already holds as raw text.
 */
export function withTypedRecipient(options: RecipientOptions, search: string, t: Translate): RecipientOptions {
  const typed = search.trim();
  if (!typed) return options;
  const key = typed.toLowerCase();
  const taken = options.some((option) => ('group' in option ? option.items : [option])
    .some((item) => item.value === typed || item.label.toLowerCase() === key));
  if (taken) return options;
  const item: RecipientOption = { value: typed, label: fillTemplate(t('flow.recipient.addTyped'), { text: typed }) };
  const group = t('flow.recipient.other');
  const at = options.findIndex((option) => 'group' in option && option.group === group);
  if (at < 0) return [...options, { group, items: [item] }];
  return options.map((option, index) => (index === at && 'group' in option ? { ...option, items: [...option.items, item] } : option));
}
