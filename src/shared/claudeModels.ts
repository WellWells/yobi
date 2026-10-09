/**
 * claude.ai's model picker, mirrored.
 *
 * Which models a user may pick depends on their plan, so the list is never hardcoded: it is
 * whatever the page offers as selectable, read each time Claude is used. Effort levels and the
 * thinking switch belong to one model each, and the page remembers them per model.
 *
 * Yobi keeps one Claude setting and makes the page match it before every send, like Gemini's.
 * Labels are the page's own text, cached as-is.
 */

export interface ClaudeOptionInfo {
  /** Language-independent id the page gives the option. */
  id: string;
  label: string;
  sublabel: string;
}

export interface ClaudeThinkingInfo {
  label: string;
  sublabel: string;
}

/** What one model offers under it. Only readable while that model is the page's selection. */
export interface ClaudeModelOptions {
  efforts: ClaudeOptionInfo[];
  thinking: ClaudeThinkingInfo | null;
}

export interface ClaudeModelInfo extends ClaudeOptionInfo {
  /** `null` until the model has been selected on the page at least once. */
  options: ClaudeModelOptions | null;
  /**
   * `true`: an older version the page keeps under "All models"; `false`: known to be current;
   * absent: not known (a list cached before this was recorded, or read where the page cannot tell).
   */
  legacy?: boolean;
}

/** One model in the page's own account data — every model the app knows, whatever the plan. */
export interface ClaudeOfficialModel {
  id: string;
  /** "Claude Sonnet 5.5" */
  name: string;
  /** Listed under "All models" rather than with the current versions. */
  legacy: boolean;
}

export interface ClaudeModelCatalog {
  models: ClaudeModelInfo[];
  updatedAt: string;
}

/**
 * The one Claude setting every path shares. Empty / `null` fields mean "whatever the page has":
 * the next read adopts them, so the account's own defaults become Yobi's.
 */
export interface ClaudeModelChoice {
  modelId: string;
  effort: string;
  thinking: boolean | null;
}

export interface ClaudeModelState {
  catalog: ClaudeModelCatalog | null;
  choice: ClaudeModelChoice;
}

export const EMPTY_CLAUDE_CHOICE: ClaudeModelChoice = { modelId: '', effort: '', thinking: null };

type Selectable<T> = T & { selected: boolean };

/** The picker as read: the selectable models, plus the options of the one the page has selected. */
export interface ClaudePickerSnapshot {
  /** `more`: read from a submenu ("All models") rather than the main menu. */
  models: (Selectable<ClaudeOptionInfo> & { more?: boolean })[];
  /** Models shown but locked to another plan. */
  locked?: string[];
  /** The page's account data, or `null` when it could not be read. */
  official?: ClaudeOfficialModel[] | null;
  /**
   * True when the page listed the models in its own order (a new chat's featured list); false
   * inside a conversation, where the main menu holds only the current model.
   */
  pageOrdered?: boolean;
  /** `null` when the options submenu could not be read. */
  options: {
    efforts: Selectable<ClaudeOptionInfo>[];
    thinking: Selectable<ClaudeThinkingInfo> | null;
  } | null;
}

/** What the page must be switched to; `null` fields are left alone. */
export interface ClaudePickerTarget {
  modelId: string | null;
  effort: string | null;
  thinking: boolean | null;
}

export interface ClaudeTargetDecision {
  target: ClaudePickerTarget;
  /** The model to keep; differs from the setting when it was adopted or is not on this account. */
  modelId: string;
  /** Set when the chosen model is not selectable on this account (another plan, or retired). */
  unavailable: string | null;
}

/**
 * Decide what to ask of the page. A model this account cannot select falls back to the page's own
 * selection — there is no sensible "same slot" when the missing rows are locked, not retired.
 */
export function resolveClaudeTarget(choice: ClaudeModelChoice, snapshot: ClaudePickerSnapshot): ClaudeTargetDecision {
  const selectedId = snapshot.models.find((model) => model.selected)?.id ?? null;
  let modelId = choice.modelId;
  let unavailable: string | null = null;

  if (snapshot.models.length > 0) {
    if (!modelId) {
      modelId = selectedId ?? '';
    } else if (!snapshot.models.some((model) => model.id === modelId)) {
      unavailable = modelId;
      modelId = selectedId ?? snapshot.models[0].id;
    }
  }

  // The options of a model that is not chosen here yet are unknown until it is; a stale effort
  // from the unavailable model is dropped rather than tried on another one.
  const keepOptions = unavailable === null;
  return {
    target: {
      modelId: snapshot.models.length > 0 && modelId && modelId !== selectedId ? modelId : null,
      effort: keepOptions && choice.effort ? choice.effort : null,
      thinking: keepOptions ? choice.thinking : null,
    },
    modelId,
    unavailable,
  };
}

/**
 * The setting after the page has been read (and switched). Anything the page does not offer for
 * this model is replaced by what the page shows, so the menu never claims a state that is not live.
 */
export function reconcileClaudeChoice(modelId: string, wanted: ClaudeModelChoice, snapshot: ClaudePickerSnapshot): ClaudeModelChoice {
  const options = snapshot.options;
  if (!options) return { modelId, effort: wanted.effort, thinking: wanted.thinking };
  const selectedEffort = options.efforts.find((effort) => effort.selected)?.id ?? '';
  const effort = wanted.effort && options.efforts.some((level) => level.id === wanted.effort)
    ? wanted.effort
    : selectedEffort;
  const thinking = options.thinking
    ? (wanted.thinking === null ? options.thinking.selected : wanted.thinking)
    : null;
  return { modelId, effort, thinking };
}

function stripSelection<T extends { selected: boolean }>(entry: T): Omit<T, 'selected'> {
  const { selected: _selected, ...rest } = entry;
  return rest;
}

/**
 * The cached list after a read: the page's selectable models, each keeping the options it showed
 * the last time it was selected; the selected one takes what was just read. An empty read keeps
 * the previous list.
 *
 * Only a new chat's featured list sets the order (inside a conversation the main menu holds just
 * the current model, which would reshuffle Yobi's menu on every switch). Other reads keep the
 * previous order, with models not seen before going last, in page order.
 */
export function mergeClaudeCatalog(
  previous: ClaudeModelCatalog | null,
  snapshot: ClaudePickerSnapshot,
  updatedAt: string,
): ClaudeModelCatalog | null {
  if (snapshot.models.length === 0) return catalogFromOfficial(previous, snapshot.official ?? null, updatedAt);
  const official = new Map((snapshot.official ?? []).map((model) => [model.id, model]));
  const before = new Map((previous?.models ?? []).map((model) => [model.id, model]));
  // Which versions are current: the account data says so outright; failing that, a new chat's
  // menu does (current ones in the main menu). A conversation's menu cannot tell, so the last
  // answer stands.
  const isLegacy = (model: ClaudePickerSnapshot['models'][number]): boolean | undefined =>
    official.get(model.id)?.legacy
    ?? (snapshot.pageOrdered ? model.more === true : before.get(model.id)?.legacy);
  const known = new Map((previous?.models ?? []).map((model) => [model.id, model.options]));
  const rank = new Map(snapshot.pageOrdered ? [] : (previous?.models ?? []).map((model, index) => [model.id, index]));
  const position = (id: string, pageIndex: number): number => rank.get(id) ?? rank.size + pageIndex;
  const ordered = snapshot.models
    .map((model, pageIndex) => ({ model, at: position(model.id, pageIndex) }))
    .sort((a, b) => a.at - b.at)
    .map(({ model }) => model);
  return {
    models: ordered.map((model) => {
      const options: ClaudeModelOptions | null = model.selected && snapshot.options
        ? {
          efforts: snapshot.options.efforts.map(stripSelection),
          thinking: snapshot.options.thinking ? stripSelection(snapshot.options.thinking) : null,
        }
        : known.get(model.id) ?? null;
      const entry: ClaudeModelInfo = { id: model.id, label: model.label, sublabel: model.sublabel, options };
      const legacy = isLegacy(model);
      if (legacy !== undefined) entry.legacy = legacy;
      return entry;
    }),
    updatedAt,
  };
}

/** "Claude Sonnet 5.5" → "Sonnet 5.5", the way the menu itself names it. */
export function claudeOfficialLabel(name: string): string {
  return name.replace(/^Claude\s+/i, '').trim() || name;
}

/** "sonnet" for every Sonnet version — the line a newer version replaces an older one in. */
export function claudeModelFamily(id: string): string {
  return id.split('-').find((part) => part !== 'claude' && /^[a-z]+$/.test(part)) ?? '';
}

/**
 * The cached list when the menu showed no models (the page moved its picker) but the account data
 * could be read: retired models go, names follow the official ones, and a new current version
 * joins when its line was already on the list as a current one, since the account could pick the
 * old version it replaces. Anything else waits for a menu that can be read; without account data,
 * nothing changes.
 */
export function catalogFromOfficial(
  previous: ClaudeModelCatalog | null,
  official: ClaudeOfficialModel[] | null,
  updatedAt: string,
): ClaudeModelCatalog | null {
  if (!previous || !official || official.length === 0) return previous;
  const kept = new Map(previous.models.map((model) => [model.id, model]));
  const lines = new Set(previous.models.filter((model) => !model.legacy).map((model) => claudeModelFamily(model.id)));
  const listed = official.filter((model) => kept.has(model.id) || (!model.legacy && lines.has(claudeModelFamily(model.id))));
  if (listed.length === 0) return previous;
  const ordered = [...listed.filter((model) => !model.legacy), ...listed.filter((model) => model.legacy)];
  return {
    models: ordered.map((model) => {
      const cached = kept.get(model.id);
      const entry: ClaudeModelInfo = {
        id: model.id,
        label: claudeOfficialLabel(model.name),
        sublabel: cached?.sublabel ?? '',
        options: cached?.options ?? null,
        legacy: model.legacy,
      };
      return entry;
    }),
    updatedAt,
  };
}

/** `claude-sonnet-4-6` → [4, 6]; a date suffix (`-20251001`) is not part of the version. */
export function claudeModelVersion(id: string): number[] {
  const parts = id.split('-');
  const line = parts.findIndex((part) => part !== 'claude' && /^[a-z]+$/.test(part));
  return parts.slice(line + 1).filter((part) => /^\d{1,2}$/.test(part)).map(Number);
}

function newerVersion(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * Was this model current in that list? Known when the list recorded it; for a list cached before
 * it was recorded, the newest version of its line on that list is taken to have been the current
 * one — the older ones beside it were a choice.
 */
function wasCurrent(model: ClaudeModelInfo, catalog: ClaudeModelCatalog): boolean {
  if (model.legacy !== undefined) return !model.legacy;
  const line = claudeModelFamily(model.id);
  const version = claudeModelVersion(model.id);
  return !catalog.models.some((other) => claudeModelFamily(other.id) === line && newerVersion(claudeModelVersion(other.id), version));
}

/**
 * The chosen model after a newer version took its place: it was current when chosen and is now
 * listed with the older versions, so the setting moves to the current version of the same line.
 * A model the user picked while it was already an older version is a deliberate choice and stays,
 * and so does one whose status is not known. Effort and thinking belong to one model, so they go
 * back to the page's own for the new one.
 */
export function upgradeClaudeChoice(
  choice: ClaudeModelChoice,
  previous: ClaudeModelCatalog | null,
  next: ClaudeModelCatalog | null,
): { choice: ClaudeModelChoice; from: string } | null {
  const was = previous?.models.find((model) => model.id === choice.modelId);
  const now = next?.models.find((model) => model.id === choice.modelId);
  if (!previous || !was || !wasCurrent(was, previous) || now?.legacy !== true) return null;
  const line = claudeModelFamily(choice.modelId);
  const current = next?.models.find((model) => model.legacy === false && claudeModelFamily(model.id) === line);
  if (!line || !current) return null;
  return { choice: { modelId: current.id, effort: '', thinking: null }, from: choice.modelId };
}

/**
 * Current models in the account data that the menu showed neither as selectable nor as locked:
 * the walk missed part of the menu, which is how a page change shows up before anything fails.
 */
export function claudeModelsMissedByMenu(snapshot: ClaudePickerSnapshot): string[] {
  if (!snapshot.official || snapshot.models.length === 0) return [];
  const seen = new Set([...snapshot.models.map((model) => model.id), ...(snapshot.locked ?? [])]);
  return snapshot.official.filter((model) => !model.legacy && !seen.has(model.id)).map((model) => model.id);
}

/** Same models, labels and options — `updatedAt` aside, which changes on every read. */
export function sameClaudeCatalogContent(a: ClaudeModelCatalog | null, b: ClaudeModelCatalog | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a.models) === JSON.stringify(b.models);
}

export function sameClaudeChoice(a: ClaudeModelChoice, b: ClaudeModelChoice): boolean {
  return a.modelId === b.modelId && a.effort === b.effort && a.thinking === b.thinking;
}

/** The chosen model's catalog entry, or `null` while nothing has been read yet. */
export function selectedClaudeModel(state: ClaudeModelState | null): ClaudeModelInfo | null {
  if (!state?.catalog) return null;
  return state.catalog.models.find((model) => model.id === state.choice.modelId) ?? null;
}

/**
 * The chosen model has never been the page's selection, so whether it has effort levels or a
 * thinking switch is not known yet — only the page can say, and only while that model is selected.
 */
export function claudeOptionsUnknown(state: ClaudeModelState | null): boolean {
  const model = selectedClaudeModel(state);
  return model !== null && model.options === null;
}

/** The chosen effort level of the chosen model, as the page labels it. */
export function selectedClaudeEffort(state: ClaudeModelState | null): ClaudeOptionInfo | null {
  const model = selectedClaudeModel(state);
  if (!model?.options || !state) return null;
  return model.options.efforts.find((effort) => effort.id === state.choice.effort) ?? null;
}
