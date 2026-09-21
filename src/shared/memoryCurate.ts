/**
 * Tidying the personal memory: a model proposes changes, the user confirms each one, and only then
 * does anything change. Shared because the renderer shows the proposal and sends back the picks.
 */

export type MemoryCurateOp = 'merge' | 'rewrite' | 'remove';

export const MEMORY_CURATE_OPS: readonly MemoryCurateOp[] = ['merge', 'rewrite', 'remove'];

/** What the model says about one entry's text when it proposes; the reason shown on the card. */
export const MEMORY_CURATE_WHY_MAX_CHARS = 200;

/** The direction the user gives, from the chat or the box on the review screen. */
export const MEMORY_CURATE_NOTE_MAX_CHARS = 500;

/**
 * The directions offered before a tidy starts, so nobody has to invent one to begin. `instruction`
 * reaches the model as the user's request, so it stays English like the rest of the prompt; only
 * the label is translated. `all` asks for nothing in particular, and `custom` is whatever the user
 * types instead.
 */
export const MEMORY_CURATE_PRESETS = [
  { key: 'all', instruction: '' },
  {
    key: 'merge',
    instruction: 'Only merge entries that say the same thing. Do not remove or rewrite anything else.',
  },
  {
    key: 'stale',
    instruction: 'Only remove entries whose date has passed or that a newer entry has replaced. Do not merge or rewrite.',
  },
  {
    key: 'rewrite',
    instruction: 'Only rewrite entries that are wordy or vague so they say the same thing in fewer words. Do not merge or remove.',
  },
  {
    key: 'conflict',
    instruction: 'Only handle entries that contradict each other, keeping what the newer entry says. Leave every other entry alone.',
  },
] as const;

export type MemoryCuratePresetKey = typeof MEMORY_CURATE_PRESETS[number]['key'];

/** What the start screen offers: a preset, or the user's own words. */
export type MemoryCurateDirection = MemoryCuratePresetKey | 'custom';

export interface MemoryCurateChange {
  /** Stable within one proposal; what the renderer sends back to pick a change. */
  key: string;
  op: MemoryCurateOp;
  /** The entries this change touches. For a merge the one with the lowest number survives. */
  ids: string[];
  /** The resulting sentence, for merge and rewrite. */
  text?: string;
  /** One sentence for the user, in the app's language. */
  why: string;
  /** False when the model only suspects the entry is out of date: the card starts unticked. */
  sure: boolean;
  /** The entries as they read when the change was proposed — shown struck through, and checked again before applying. */
  before: Array<{ id: string; text: string }>;
}

export interface MemoryCurateProposal {
  id: string;
  /** The model that actually answered. */
  providerUrl: string;
  changes: MemoryCurateChange[];
}

export type MemoryCurateFailure = 'empty' | 'cancelled' | 'failed';

export type MemoryCurateProposeResult =
  | { ok: true; proposal: MemoryCurateProposal }
  | { ok: false; reason: MemoryCurateFailure; error?: string };

export interface MemoryCurateProposeRequest {
  providerUrl: string;
  /** What to focus on, in the user's words. */
  instruction?: string;
  /** Asks again, showing the model its last proposal and what the user said about it. */
  feedback?: string;
}

export interface MemoryCuratePick {
  key: string;
  /** The user's edit of a merge or rewrite sentence. */
  text?: string;
}

export type MemoryCurateApplyResult =
  | {
    ok: true;
    applied: number;
    /** Changes whose entries were changed elsewhere while the user was reviewing. */
    skipped: number;
    /** Changes that no longer fit: a duplicate, too long, or over the memory's cap. */
    failed: number;
    undoable: boolean;
  }
  | { ok: false; reason: 'expired' };
