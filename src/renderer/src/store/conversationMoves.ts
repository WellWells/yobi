import { useEffect, useRef } from 'react';
import type { OutputFile } from '../../../shared/types';
import type { ConversationMove } from '../../../shared/conversationMove';
import { baseNameOf, movedPathFor } from '../../../shared/conversationMove';
import { ipcEvents } from '../api/electronApi';
import { useAppStore } from './appStore';
import type { PendingTurn } from './appStore';
import { useAnswerEditStore } from './answerEditStore';
import type { AnswerDraft, SavedAnswerEdit } from './answerEditStore';
import { useTranslateStore } from './translateStore';
import { useWritingToolsStore } from './writingToolsStore';
import { useDocAssistantStore } from './docAssistantStore';
import { useAgentRunStore } from './useAgentRunStore';
import { useRecapStore } from './recapStore';
import type { RecapState } from '../utils/recapState';

/*
 * A conversation moved into (or out of) a folder keeps everything the renderer holds for it: the
 * open conversation stays open, a draft stays a draft, a waiting Agent question still answers it.
 * Every path-keyed store is re-keyed here, once per CONVERSATION_MOVED from main; component state
 * keyed by path (row selection, the title being edited, sends in flight) listens with
 * `useConversationMoves`.
 */

type Listener = (moves: readonly ConversationMove[]) => void;
const listeners = new Set<Listener>();

/** `path` after the moves; unchanged when it was not moved. */
export function remapPath(moves: readonly ConversationMove[], path: string): string {
  return movedPathFor(moves, path) ?? path;
}

/** Re-points, in place, each value that is a moved path (a send's origin by its send id). */
export function remapPathValues(map: Map<string, string>, moves: readonly ConversationMove[]): void {
  for (const [key, path] of map) {
    const to = movedPathFor(moves, path);
    if (to) map.set(key, to);
  }
}

/** The record with each key's path part re-keyed; the same object when nothing moved. */
export function remapKeyed<T>(
  record: Record<string, T>,
  moves: readonly ConversationMove[],
  split: (key: string) => { path: string; rebuild: (path: string) => string } | null,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const parts = split(key);
    const moved = parts ? movedPathFor(moves, parts.path) : null;
    if (parts && moved) {
      next[parts.rebuild(moved)] = value;
      changed = true;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : record;
}

const wholeKey = (key: string) => ({ path: key, rebuild: (path: string) => path });

/** `${turnIndex}\0${path}` (answer drafts). */
function draftKeyParts(key: string): { path: string; rebuild: (path: string) => string } | null {
  const cut = key.indexOf('\u0000');
  if (cut < 0) return null;
  const turn = key.slice(0, cut);
  return { path: key.slice(cut + 1), rebuild: (path) => `${turn}\u0000${path}` };
}

/** `${path}#${turnIndex}` (translations); the last `#` is the turn's. */
function turnKeyParts(key: string): { path: string; rebuild: (path: string) => string } | null {
  const cut = key.lastIndexOf('#');
  if (cut < 0) return null;
  const turn = key.slice(cut + 1);
  return { path: key.slice(0, cut), rebuild: (path) => `${path}#${turn}` };
}

/** `${path}\n${at}` (closed recap lines). */
function recapKeyParts(key: string): { path: string; rebuild: (path: string) => string } | null {
  const cut = key.indexOf('\n');
  if (cut < 0) return null;
  const at = key.slice(cut + 1);
  return { path: key.slice(0, cut), rebuild: (path) => `${path}\n${at}` };
}

function movedFile(moves: readonly ConversationMove[], file: OutputFile): OutputFile {
  const to = movedPathFor(moves, file.path);
  return to ? { ...file, path: to, name: baseNameOf(to) } : file;
}

function applyToAppStore(moves: readonly ConversationMove[]): void {
  useAppStore.setState((state) => {
    const selected = state.selectedFile ? movedFile(moves, state.selectedFile) : null;
    const files = state.files.some((file) => movedPathFor(moves, file.path))
      ? state.files.map((file) => movedFile(moves, file))
      : state.files;
    const pendingTurns = remapKeyed<PendingTurn[]>(state.pendingTurns, moves, wholeKey);
    const unreadFilePaths = remapKeyed<true>(state.unreadFilePaths, moves, wholeKey);
    return {
      files,
      selectedFile: selected,
      pendingTurns,
      unreadFilePaths,
    };
  });
}

function applyToAnswerEdits(moves: readonly ConversationMove[]): void {
  useAnswerEditStore.setState((state) => {
    const drafts = remapKeyed<AnswerDraft>(state.drafts, moves, draftKeyParts);
    const savedTo = state.saved ? movedPathFor(moves, state.saved.path) : null;
    const saved: SavedAnswerEdit | null = state.saved && savedTo ? { ...state.saved, path: savedTo } : state.saved;
    return { drafts, saved };
  });
}

function applyToTranslations(moves: readonly ConversationMove[]): void {
  useTranslateStore.setState((state) => {
    const conversationTo = state.conversation ? movedPathFor(moves, state.conversation.path) : null;
    return {
      jobs: remapKeyed(state.jobs, moves, turnKeyParts),
      memory: remapKeyed(state.memory, moves, turnKeyParts),
      views: remapKeyed(state.views, moves, turnKeyParts),
      conversation: state.conversation && conversationTo ? { ...state.conversation, path: conversationTo } : state.conversation,
    };
  });
}

function applyToWritingTools(moves: readonly ConversationMove[]): void {
  // Read first, then set: synchronous, and the rewrite's `target` is not an event's.
  const { job } = useWritingToolsStore.getState();
  const to = job ? movedPathFor(moves, job.target.path) : null;
  if (!job || !to) return;
  useWritingToolsStore.setState({ job: { ...job, target: { ...job.target, path: to } } });
}

function applyToDocAssistant(moves: readonly ConversationMove[]): void {
  useDocAssistantStore.setState((state) => ({ threads: remapKeyed(state.threads, moves, wholeKey) }));
}

function applyToAgentRuns(moves: readonly ConversationMove[]): void {
  useAgentRunStore.setState((state) => {
    const pending = state.pendingQuestion;
    const pendingTo = pending ? movedPathFor(moves, pending.conversationPath) : null;
    const resumable = state.resumable.some((run) => movedPathFor(moves, run.conversationPath))
      ? state.resumable.map((run) => {
        const to = movedPathFor(moves, run.conversationPath);
        return to ? { ...run, conversationPath: to } : run;
      })
      : state.resumable;
    return {
      pendingQuestion: pending && pendingTo ? { ...pending, conversationPath: pendingTo } : pending,
      resumable,
    };
  });
}

/** The recap state with its paths re-keyed. */
export function remapRecapState(state: RecapState, moves: readonly ConversationMove[]): RecapState {
  const armedTo = state.armed ? movedPathFor(moves, state.armed.path) : null;
  const pendingTo = movedPathFor(moves, state.pendingOpen);
  const dismissedRecord = Object.fromEntries([...state.dismissed].map((key) => [key, true as const]));
  const remapped = remapKeyed(dismissedRecord, moves, recapKeyParts);
  if (!armedTo && !pendingTo && remapped === dismissedRecord) return state;
  return {
    armed: state.armed && armedTo ? { ...state.armed, path: armedTo } : state.armed,
    dismissed: remapped === dismissedRecord ? state.dismissed : new Set(Object.keys(remapped)),
    pendingOpen: pendingTo ?? state.pendingOpen,
  };
}

function applyToRecap(moves: readonly ConversationMove[]): void {
  useRecapStore.setState((store) => {
    const next = remapRecapState(store.state, moves);
    return next === store.state ? store : { state: next };
  });
}

/** Re-keys every path-keyed store, then tells the listeners. */
export function applyConversationMoves(moves: readonly ConversationMove[]): void {
  if (moves.length === 0) return;
  applyToAppStore(moves);
  applyToAnswerEdits(moves);
  applyToTranslations(moves);
  applyToWritingTools(moves);
  applyToDocAssistant(moves);
  applyToAgentRuns(moves);
  applyToRecap(moves);
  for (const listener of listeners) listener(moves);
}

export function subscribeConversationMoves(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Calls `listener` (the latest one rendered) on every move, for state a component keeps by path. */
export function useConversationMoves(listener: Listener): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => subscribeConversationMoves((moves) => latest.current(moves)), []);
}

let stopSync: (() => void) | null = null;

/** Subscribes once to main's CONVERSATION_MOVED; later calls do nothing. */
export function startConversationMoveSync(): void {
  if (stopSync) return;
  stopSync = ipcEvents.onConversationMoved((event) => applyConversationMoves(event.moves));
}
