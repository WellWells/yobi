import { DEFAULT_SKILL_CONFIG } from '../shared/flowSkillSpecs';
import type { FlowDefinition, FlowVariable, SkillInstance, TriggerConfig } from '../shared/types';

/*
 * What "explain this flow" reads: the whole flow, every step with every setting it runs with.
 * Unlike the edit material (`renderFlowForEdit`, which leaves out defaults so the model does not
 * write them back), a setting left at its default still decides what the step does — "platform:
 * auto" is where the message goes — so the explanation sees it. Only blank settings are left out.
 *
 * Chats are named, not numbered: given the ids, the explanation said the results go to a Telegram
 * chat "-100…" while the step itself shows the group's name. Every chat id the material holds — a
 * bot step's recipients, a chat variable's value, a trigger's allowed users — that this computer
 * can name is replaced by the name the editor shows for it; only an id nothing names stays as is.
 */

/** Chat ids → the names the recipient picker shows (`loadChatNames`). */
export type ChatNames = ReadonlyMap<string, string>;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every known chat id in the text, as a whole token, replaced by its name. */
export function nameChatIds(text: string, names: ChatNames): string {
  if (names.size === 0 || !text) return text;
  const ids = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (ids.length === 0) return text;
  const pattern = new RegExp(`(?<![\\w-])(?:${ids.join('|')})(?![\\w-])`, 'g');
  return text.replace(pattern, (id) => names.get(id) ?? id);
}

function stepSettings(step: SkillInstance, names: ChatNames): Record<string, string> {
  const merged: Record<string, string> = { ...(DEFAULT_SKILL_CONFIG[step.type] ?? {}), ...step.config };
  // A step saved before `chatIds` existed still has its recipients under `chatId`.
  if (step.type === 'bot' && !merged.chatIds?.trim() && merged.chatId?.trim()) merged.chatIds = merged.chatId;
  if (step.type === 'bot') delete merged.chatId;
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value.trim()) settings[key] = nameChatIds(value, names);
  }
  return settings;
}

function triggerMaterial(trigger: TriggerConfig, names: ChatNames): Record<string, unknown> {
  const { botAllowedUserIds, ...rest } = trigger;
  const out: Record<string, unknown> = { ...rest };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string') out[key] = nameChatIds(value, names);
  }
  if (botAllowedUserIds?.length) out.botAllowedUsers = botAllowedUserIds.map((id) => names.get(id) ?? id);
  return out;
}

function variableMaterial(variable: FlowVariable, names: ChatNames): Record<string, unknown> {
  return { ...variable, value: nameChatIds(variable.value ?? '', names) };
}

/**
 * The flow as one JSON document. Each step carries its position instead of its id: the person sees
 * "step 2" in the editor, and the model otherwise names steps by an id they never see.
 */
export function renderFlowForExplain(flow: FlowDefinition, names: ChatNames = new Map()): string {
  return JSON.stringify({
    name: flow.name,
    ...(flow.description?.trim() ? { description: flow.description } : {}),
    enabled: flow.enabled,
    ...(flow.publicWebOnly ? { publicWebOnly: true } : {}),
    trigger: triggerMaterial(flow.trigger, names),
    ...(flow.extraTriggers?.length ? { extraTriggers: flow.extraTriggers.map((trigger) => triggerMaterial(trigger, names)) } : {}),
    ...(flow.variables?.length ? { variables: flow.variables.map((variable) => variableMaterial(variable, names)) } : {}),
    steps: flow.steps.map((step, index) => ({
      step: index + 1,
      type: step.type,
      ...(step.label?.trim() ? { label: step.label } : {}),
      settings: stepSettings(step, names),
      ...(step.outputKey?.trim() ? { outputKey: step.outputKey } : {}),
    })),
  }, null, 2);
}

/** A contact as the contact directory keeps it: a group's title, a person's name. */
export interface NamedContact {
  id: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

function contactName(contact: NamedContact): string {
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return contact.title?.trim() || fullName || (contact.username ? `@${contact.username}` : '');
}

/**
 * Chat ids → names: the recipient picker's own list first (paired people, channels, LINE PC's
 * chats), then every chat and person the bots have met (a group keeps its title there after it
 * leaves the lists). An id with no name is left out, so it stays as written.
 */
export function chatNamesFrom(
  entries: ReadonlyArray<{ id: string; label: string }>,
  contacts: readonly NamedContact[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of entries) {
    const label = entry.label.trim();
    if (label && label !== entry.id && !names.has(entry.id)) names.set(entry.id, label);
  }
  for (const contact of contacts) {
    const name = contactName(contact);
    if (name && !names.has(contact.id)) names.set(contact.id, name);
  }
  return names;
}
