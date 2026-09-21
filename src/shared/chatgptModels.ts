/**
 * chatgpt.com's model picker, mirrored.
 *
 * What the composer offers depends on the plan (measured 2026-09-18):
 * - Free: one "Think" pill that toggles (`aria-pressed`) — off is the default model, on Thinking mini.
 * - Plus: an effort slider (Instant, Medium, High; a locked step belongs to a higher plan) with the
 *   model versions (GPT-5.6 Sol, GPT-5.5) behind it. Every version offers its own steps.
 *
 * Only the current step's label is on the page, so the list comes from the page's own model API
 * (the account's versions and their presets), matched to the picker's rows. Yobi keeps ONE ChatGPT
 * setting and makes the page match it before every send, like Gemini's and Claude's.
 */

export interface ChatgptOptionInfo {
  /** A version id ("5.6") or a preset key ("instant", "thinking:extended") — language independent. */
  id: string;
  label: string;
  sublabel: string;
}

export interface ChatgptModelInfo extends ChatgptOptionInfo {
  /** The effort steps this model offers, in the slider's order. */
  efforts: ChatgptOptionInfo[];
}

export interface ChatgptThinkingInfo {
  label: string;
  sublabel: string;
}

export interface ChatgptModelCatalog {
  /** Empty on a plan with no model choice (Free). */
  models: ChatgptModelInfo[];
  /** The Free plan's toggle; `null` where the slider replaces it. */
  thinking: ChatgptThinkingInfo | null;
  updatedAt: string;
}

/**
 * The one ChatGPT setting every path shares. Empty / `null` fields mean "whatever the page has":
 * the next read adopts them, so the account's own defaults become Yobi's.
 */
export interface ChatgptModelChoice {
  modelId: string;
  effort: string;
  thinking: boolean | null;
}

export interface ChatgptModelState {
  catalog: ChatgptModelCatalog | null;
  choice: ChatgptModelChoice;
}

export const EMPTY_CHATGPT_CHOICE: ChatgptModelChoice = { modelId: '', effort: '', thinking: null };

type Selectable<T> = T & { selected: boolean };

export type ChatgptSnapshotModel = Selectable<ChatgptOptionInfo> & { efforts: Selectable<ChatgptOptionInfo>[] };

/** The picker as read. Only the selected model can have a selected effort. */
export interface ChatgptPickerSnapshot {
  models: ChatgptSnapshotModel[];
  thinking: Selectable<ChatgptThinkingInfo> | null;
}

/** What the page must be switched to; `null` fields are left alone. */
export interface ChatgptPickerTarget {
  modelId: string | null;
  effort: string | null;
  thinking: boolean | null;
}

export interface ChatgptTargetDecision {
  target: ChatgptPickerTarget;
  /** The model to keep; differs from the setting when it was adopted or is not on this account. */
  modelId: string;
  /** Set when the chosen model is not offered on this account (another plan, or retired). */
  unavailable: string | null;
}

/**
 * Decide what to ask of the page. A model this account does not offer falls back to the page's own
 * selection; an effort the (resulting) model does not offer is left to the page.
 */
export function resolveChatgptTarget(choice: ChatgptModelChoice, snapshot: ChatgptPickerSnapshot): ChatgptTargetDecision {
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

  const model = snapshot.models.find((entry) => entry.id === modelId);
  const offersEffort = !!choice.effort && !!model?.efforts.some((effort) => effort.id === choice.effort);
  return {
    target: {
      modelId: model && modelId !== selectedId ? modelId : null,
      effort: offersEffort ? choice.effort : null,
      thinking: snapshot.thinking ? choice.thinking : null,
    },
    modelId,
    unavailable,
  };
}

/**
 * The setting after the page has been read (and switched). Anything the page does not offer is
 * replaced by what the page shows, so the menu never claims a state that is not live.
 */
export function reconcileChatgptChoice(modelId: string, wanted: ChatgptModelChoice, snapshot: ChatgptPickerSnapshot): ChatgptModelChoice {
  const model = snapshot.models.find((entry) => entry.id === modelId);
  const live = model?.efforts.find((effort) => effort.selected)?.id ?? '';
  const effort = model && wanted.effort && model.efforts.some((step) => step.id === wanted.effort)
    ? wanted.effort
    : live;
  const thinking = snapshot.thinking
    ? (wanted.thinking === null ? snapshot.thinking.selected : wanted.thinking)
    : null;
  return { modelId: model ? modelId : '', effort, thinking };
}

function stripSelection<T extends { selected: boolean }>(entry: T): Omit<T, 'selected'> {
  const { selected: _selected, ...rest } = entry;
  return rest;
}

/**
 * The cached list after a read. Every read sees the whole list (the model API returns every version
 * with its steps), so it replaces the previous one; an empty read keeps it — a picker that renders
 * nothing for a moment is not news.
 */
export function chatgptCatalogFromSnapshot(
  previous: ChatgptModelCatalog | null,
  snapshot: ChatgptPickerSnapshot,
  updatedAt: string,
): ChatgptModelCatalog | null {
  if (snapshot.models.length === 0 && !snapshot.thinking) return previous;
  return {
    models: snapshot.models.map((model) => ({
      id: model.id,
      label: model.label,
      sublabel: model.sublabel,
      efforts: model.efforts.map(stripSelection),
    })),
    thinking: snapshot.thinking ? stripSelection(snapshot.thinking) : null,
    updatedAt,
  };
}

/** Same models, steps and toggle — `updatedAt` aside, which changes on every read. */
export function sameChatgptCatalogContent(a: ChatgptModelCatalog | null, b: ChatgptModelCatalog | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify([a.models, a.thinking]) === JSON.stringify([b.models, b.thinking]);
}

export function sameChatgptChoice(a: ChatgptModelChoice, b: ChatgptModelChoice): boolean {
  return a.modelId === b.modelId && a.effort === b.effort && a.thinking === b.thinking;
}

/** The chosen model's catalog entry, or `null` on a plan without models or before the first read. */
export function selectedChatgptModel(state: ChatgptModelState | null): ChatgptModelInfo | null {
  if (!state?.catalog) return null;
  return state.catalog.models.find((model) => model.id === state.choice.modelId) ?? null;
}

/** The chosen effort step of the chosen model, as the page labels it. */
export function selectedChatgptEffort(state: ChatgptModelState | null): ChatgptOptionInfo | null {
  const model = selectedChatgptModel(state);
  if (!model || !state) return null;
  return model.efforts.find((effort) => effort.id === state.choice.effort) ?? null;
}
