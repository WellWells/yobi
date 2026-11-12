import type { FlowDefinition } from './types';

/*
 * Sorting the flows that are in no folder yet ("智慧分類"). The chosen model proposes folders, the
 * user ticks and renames, and only what they kept is filed. Pure types and limits, shared by main
 * and the window.
 */

/** One sentence per folder, telling the user why these flows belong together. */
export const FLOW_SORT_WHY_MAX_CHARS = 200;

/** The user's own words (what to sort by, or a comment on the last proposal). */
export const FLOW_SORT_NOTE_MAX_CHARS = 500;

/**
 * At most this many unfiled flows go to the model in one round. Past it the list alone would not
 * fit a signed-out web model's prompt; the rest stay where they are for the next round.
 */
export const FLOW_SORT_MAX_FLOWS = 100;

export interface FlowSortGroup {
  /** Stable within one proposal; what the window sends back to pick a group. */
  key: string;
  /** An existing folder's own spelling, or the name proposed for a new one. */
  folder: string;
  /** False when the flows go into a folder the user already has. */
  isNew: boolean;
  /** The flows proposed for it, in the sidebar's order. */
  flowIds: string[];
  /** One sentence for the user, in the app's language. */
  why: string;
}

export interface FlowSortProposal {
  id: string;
  /** The model that actually answered. */
  providerUrl: string;
  groups: FlowSortGroup[];
  /** Unfiled flows the model put nowhere: they stay at the top level. */
  leftOver: string[];
  /** Unfiled flows past `FLOW_SORT_MAX_FLOWS`, not shown to the model this round. */
  notSent: number;
}

export type FlowSortFailure = 'empty' | 'cancelled' | 'failed';

export type FlowSortProposeResult =
  | { ok: true; proposal: FlowSortProposal }
  | { ok: false; reason: FlowSortFailure; error?: string };

export interface FlowSortProposeRequest {
  providerUrl: string;
  /** How to sort, in the user's words. */
  instruction?: string;
  /** Asks again, showing the model its last proposal and what the user said about it. */
  feedback?: string;
}

export interface FlowSortPick {
  key: string;
  /** The ticked flows; only those of the group as proposed count. */
  flowIds: string[];
  /** The user's name for a new folder. */
  folder?: string;
}

export type FlowSortApplyResult =
  | {
    ok: true;
    /** Flows filed into a folder. */
    moved: number;
    /** Folders that got at least one flow. */
    folders: number;
    /** Flows the user had filed elsewhere, or deleted, while reviewing. */
    skipped: number;
    /** Flows that could not be filed (an unusable folder name, a write that failed). */
    failed: number;
    /** Every flow in its new order, when filing changed `flows.json`'s order. */
    flows?: FlowDefinition[];
    undoable: boolean;
  }
  | { ok: false; reason: 'expired' };

export interface FlowSortUndoResult {
  ok: boolean;
  flows?: FlowDefinition[];
}
