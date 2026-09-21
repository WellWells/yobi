/**
 * claude.ai's model picker, mirrored.
 *
 * Which models a user may pick depends on their plan (Free: Sonnet and Haiku; Pro/Max add Opus and
 * Fable), so the list is never hardcoded: it is whatever the page offers as selectable, read each
 * time Claude is used. Effort levels and the thinking switch belong to ONE model each — Sonnet 5
 * has five levels, Sonnet 4.6 four, Haiku none — and the page remembers them per model.
 *
 * Yobi keeps ONE Claude setting and makes the page match it before every send, like Gemini's.
 * Labels are the page's own text, cached as-is.
 */

export interface ClaudeOptionInfo {
  /** `data-model-id` / `data-effort-id` — language independent. */
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
  models: Selectable<ClaudeOptionInfo>[];
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
 * the previous list — a menu that renders nothing for a moment is not news.
 *
 * Order: inside a conversation the page's main menu holds only the current model and "More
 * models" the rest (measured), so that order would reshuffle Yobi's menu on every switch. Only a
 * new chat's featured list sets the order; other reads keep the previous one, with models not
 * seen before going last, in page order.
 */
export function mergeClaudeCatalog(
  previous: ClaudeModelCatalog | null,
  snapshot: ClaudePickerSnapshot,
  updatedAt: string,
): ClaudeModelCatalog | null {
  if (snapshot.models.length === 0) return previous;
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
      return { id: model.id, label: model.label, sublabel: model.sublabel, options };
    }),
    updatedAt,
  };
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
