import { fillTemplate } from '../../../shared/fillTemplate';
import type { FlowVariable } from '../../../shared/types';

type Translate = (key: string) => string;

export interface ChatOption {
  value: string;
  label: string;
}

export interface ChatOptionGroup {
  group: string;
  items: ChatOption[];
}

const VARIABLE_RE = /^\{\{\s*var\.([^}\s]+)\s*\}\}$/;
const TEMPLATE_RE = /\{\{[^}]+\}\}/;

/** A Telegram number or a LINE `c…`/`u…`/`r…` hex id: something only a list can name. */
export function looksLikeChatId(token: string): boolean {
  return /^-?\d{5,}$/.test(token) || /^[cur]?[0-9a-f]{16,}$/i.test(token);
}

/**
 * Chats that share a name get told apart: by their kind when that differs, else by a running
 * number. Every other chat keeps its bare name.
 */
export function distinctChatLabels<T extends { id: string; name: string; kind?: string }>(
  chats: readonly T[],
  t: Translate,
  kindName?: (kind: string) => string,
): Map<string, string> {
  const byName = new Map<string, T[]>();
  for (const chat of chats) byName.set(chat.name, [...(byName.get(chat.name) ?? []), chat]);
  const labels = new Map<string, string>();
  for (const [name, same] of byName) {
    if (same.length === 1) {
      labels.set(same[0]!.id, name);
      continue;
    }
    const kinds = new Set(same.map((chat) => chat.kind ?? ''));
    same.forEach((chat, index) => {
      const detail = kindName && kinds.size === same.length && chat.kind ? kindName(chat.kind) : String(index + 1);
      labels.set(chat.id, fillTemplate(t('flow.chatPicker.sameName'), { name, detail }));
    });
  }
  return labels;
}

export interface SavedChatContext {
  t: Translate;
  variables?: readonly FlowVariable[];
  /** Names learned from an earlier read of the list, for while it is read again. */
  names?: ReadonlyMap<string, string>;
  /** The list is still being read: an id is not yet "not found". */
  loading: boolean;
  /** Headings: the flow settings group, and the one for ids the list does not have. */
  settingsGroup: string;
  missingGroup: string;
}

/**
 * The choices for what the field already holds and the list does not offer, so a picked value is
 * always a named pill — never a raw id, and never removable only after the list arrives. A flow
 * setting is its setting's name in a group of its own (it is not "missing"); an id is the name
 * from an earlier read, "Loading…" while the list is read, else "not in the list N"; a name typed
 * as a name is itself.
 */
export function savedChatOptions(selected: readonly string[], offered: ReadonlySet<string>, ctx: SavedChatContext): ChatOptionGroup[] {
  const settings: ChatOption[] = [];
  const missing: ChatOption[] = [];
  let unlisted = 0;
  for (const token of selected) {
    if (offered.has(token)) continue;
    const variable = VARIABLE_RE.exec(token);
    if (variable) {
      const found = ctx.variables?.find((item) => item.key === variable[1]);
      settings.push({ value: token, label: fillTemplate(ctx.t('flow.recipient.variable'), { name: found?.label.trim() || variable[1]! }) });
    } else if (TEMPLATE_RE.test(token)) {
      settings.push({ value: token, label: token });
    } else if (!looksLikeChatId(token)) {
      missing.push({ value: token, label: token });
    } else {
      const name = ctx.names?.get(token);
      const label = name ?? (ctx.loading ? ctx.t('flow.recipient.loadingChat') : fillTemplate(ctx.t('flow.recipient.unlistedChat'), { n: String(++unlisted) }));
      missing.push({ value: token, label });
    }
  }
  return [
    ...(settings.length > 0 ? [{ group: ctx.settingsGroup, items: settings }] : []),
    ...(missing.length > 0 ? [{ group: ctx.missingGroup, items: missing }] : []),
  ];
}
