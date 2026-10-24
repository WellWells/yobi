/*
 * How the conversation list is ordered and grouped (Apple Notes' View › Sort By and Group by
 * Date). Global, stored in config.json and mirrored to localStorage so the first paint already
 * uses it. Pure.
 */

export const CONVERSATION_SORTS = ['activity', 'created', 'title'] as const;
export type ConversationSort = typeof CONVERSATION_SORTS[number];

export interface SidebarViewPrefs {
  sort: ConversationSort;
  groupByDate: boolean;
}

export const DEFAULT_SIDEBAR_VIEW: SidebarViewPrefs = {
  sort: 'activity',
  groupByDate: true,
};

export function isConversationSort(value: unknown): value is ConversationSort {
  return typeof value === 'string' && (CONVERSATION_SORTS as readonly string[]).includes(value);
}

/** Anything not exactly right falls back to its default; only a real `false` turns grouping off. */
export function normalizeSidebarView(value: unknown): SidebarViewPrefs {
  const obj = value && typeof value === 'object' ? value as Partial<Record<keyof SidebarViewPrefs, unknown>> : {};
  return {
    sort: isConversationSort(obj.sort) ? obj.sort : DEFAULT_SIDEBAR_VIEW.sort,
    groupByDate: obj.groupByDate !== false,
  };
}

/** Merges a partial update; unknown or malformed fields keep the current value. */
export function mergeSidebarView(current: SidebarViewPrefs, patch: unknown): SidebarViewPrefs {
  const obj = patch && typeof patch === 'object' ? patch as Partial<Record<keyof SidebarViewPrefs, unknown>> : {};
  return {
    sort: isConversationSort(obj.sort) ? obj.sort : current.sort,
    groupByDate: typeof obj.groupByDate === 'boolean' ? obj.groupByDate : current.groupByDate,
  };
}
