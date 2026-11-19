/**
 * Perplexity's model menu, mirrored for a signed-in account.
 *
 * The menu lists the models the plan can use as radio rows; rows of another plan carry a lock and
 * are a different kind of row, and a visitor sees only those. Yobi lists what can be chosen and
 * nothing else, so a visitor (or a page whose menu can no longer be read) has no list at all and
 * the page keeps deciding by itself.
 *
 * Rows have no id of their own. A model is known by its name, which the page marks as not to be
 * translated; the page's own "pick for me" row is the one without a submenu and gets a fixed id.
 */

/** The row that lets the page choose the model. */
export const PERPLEXITY_AUTO_MODEL_ID = 'auto';

export interface PerplexityModelInfo {
  id: string;
  /** The page's own text for the row. */
  label: string;
}

/** What the page offered the last time it was read; the model menu is drawn from this. */
export interface PerplexityModelCatalog {
  models: PerplexityModelInfo[];
  updatedAt: string;
}

/** An empty `modelId` means "not decided": the next read adopts whatever the page has selected. */
export interface PerplexityModelChoice {
  modelId: string;
}

export interface PerplexityModelState {
  catalog: PerplexityModelCatalog | null;
  choice: PerplexityModelChoice;
}

export const EMPTY_PERPLEXITY_CHOICE: PerplexityModelChoice = { modelId: '' };

/** The menu as read: the rows that can be chosen, and which one is. */
export interface PerplexityPickerSnapshot {
  models: (PerplexityModelInfo & { selected: boolean })[];
}

/** What the page must be switched to; `null` leaves it alone. */
export interface PerplexityPickerTarget {
  modelId: string | null;
}

export interface PerplexityTargetDecision {
  target: PerplexityPickerTarget;
  /** The setting to keep from now on. */
  choice: PerplexityModelChoice;
  /** Set when the chosen model is not in the menu, so the page's own selection was kept. */
  unavailable: string | null;
}

/**
 * Decide what the page should show. A chosen model the menu does not list is never replaced by a
 * guess: nothing is clicked and the page's own selection becomes the setting. A menu that lists
 * nothing (a visitor, or a page that changed) leaves both the page and the setting alone.
 */
export function resolvePerplexityTarget(
  choice: PerplexityModelChoice,
  snapshot: PerplexityPickerSnapshot,
): PerplexityTargetDecision {
  if (snapshot.models.length === 0) {
    return { target: { modelId: null }, choice, unavailable: null };
  }
  const selectedId = snapshot.models.find((model) => model.selected)?.id ?? '';
  if (!choice.modelId) {
    return { target: { modelId: null }, choice: { modelId: selectedId }, unavailable: null };
  }
  if (!snapshot.models.some((model) => model.id === choice.modelId)) {
    return { target: { modelId: null }, choice: { modelId: selectedId }, unavailable: choice.modelId };
  }
  return {
    target: { modelId: choice.modelId === selectedId ? null : choice.modelId },
    choice,
    unavailable: null,
  };
}

export function perplexitySnapshotToCatalog(snapshot: PerplexityPickerSnapshot, updatedAt: string): PerplexityModelCatalog {
  return { models: snapshot.models.map(({ id, label }) => ({ id, label })), updatedAt };
}

/** Same rows with the same text — `updatedAt` aside, which changes on every read. */
export function samePerplexityCatalogContent(a: PerplexityModelCatalog | null, b: PerplexityModelCatalog | null): boolean {
  if (!a || !b) return a === b;
  const rows = (catalog: PerplexityModelCatalog) => JSON.stringify(catalog.models.map((m) => [m.id, m.label]));
  return rows(a) === rows(b);
}

export function samePerplexityChoice(a: PerplexityModelChoice, b: PerplexityModelChoice): boolean {
  return a.modelId === b.modelId;
}

/** The selected model's catalog entry, or `null` while nothing has been read yet. */
export function selectedPerplexityModel(state: PerplexityModelState | null): PerplexityModelInfo | null {
  if (!state?.catalog) return null;
  return state.catalog.models.find((model) => model.id === state.choice.modelId) ?? null;
}
