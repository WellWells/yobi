import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { languageForLocale } from '../../shared/localeLanguage';
import { MEMORY_CURATE_NOTE_MAX_CHARS } from '../../shared/memoryCurate';
import type {
  MemoryCurateApplyResult,
  MemoryCuratePick,
  MemoryCurateProposal,
  MemoryCurateProposeRequest,
  MemoryCurateProposeResult,
} from '../../shared/memoryCurate';
import { config, saveConfig } from '../config';
import { askJson } from '../flow/agent/structuredLlm';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog } from '../helpers';
import {
  applyCuration,
  buildCuratePrompt,
  loadUserMemory,
  onUserMemoryChanged,
  sameEntries,
  undoCuration,
  updateUserMemory,
  validateCurateReply,
} from '../memory';
import type { CuratePromptInput, CurationUndo } from '../memory';
import { ensureWorkerWindow, getWorkerWin } from '../windows';

/**
 * Tidying the personal memory. The model proposes, the user confirms each change, and only the
 * confirmed ones are written — nothing here changes the memory on the model's word alone.
 *
 * Main keeps the latest proposal itself and the renderer sends back only which changes to apply:
 * the entries a change touches and the text it was checked against are never taken from the
 * renderer's copy.
 */
let latest: MemoryCurateProposal | null = null;
let running: AbortController | null = null;
/**
 * What "undo" puts back. In memory only, and dropped the moment the memory changes any other way:
 * after "forget X" or "clear all", X must be gone — not waiting in a file, or in a backup of it.
 */
let undo: CurationUndo | null = null;

function curateModelUrl(): string {
  return config.memoryCurateUrl.trim() || config.targetUrl;
}

/** Remembered only when it differs from what would be used anyway, so "follow the chat model" survives picking it. */
function rememberModel(providerUrl: string): void {
  if (providerUrl === curateModelUrl()) return;
  config.memoryCurateUrl = providerUrl;
  saveConfig({ memoryCurateUrl: providerUrl });
}

function clip(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MEMORY_CURATE_NOTE_MAX_CHARS) : '';
}

/** The user's calendar day: "next week" is judged against the date on their wall. */
function localDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function workerDeps(providerUrl: string): FlowExecutorDeps {
  return {
    getWorkerWin,
    ensureWorkerWin: () => ensureWorkerWindow(providerUrl, 'automation'),
    getTargetUrl: () => providerUrl,
  };
}

function normalizePicks(raw: unknown): MemoryCuratePick[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): MemoryCuratePick[] => {
    if (!item || typeof item !== 'object') return [];
    const pick = item as Record<string, unknown>;
    if (typeof pick.key !== 'string' || !pick.key) return [];
    return [{ key: pick.key, ...(typeof pick.text === 'string' ? { text: pick.text.slice(0, MEMORY_CURATE_NOTE_MAX_CHARS) } : {}) }];
  });
}

async function propose(request: MemoryCurateProposeRequest): Promise<MemoryCurateProposeResult> {
  const providerUrl = clip(request?.providerUrl) || curateModelUrl();
  rememberModel(providerUrl);
  const state = await loadUserMemory();
  if (state.entries.length === 0) return { ok: false, reason: 'empty' };

  running?.abort();
  const controller = new AbortController();
  running = controller;
  const instruction = clip(request?.instruction);
  const feedback = clip(request?.feedback);
  const input: CuratePromptInput = {
    entries: state.entries,
    today: localDate(new Date()),
    language: languageForLocale(config.locale),
    ...(instruction ? { instruction } : {}),
    ...(feedback ? { feedback, ...(latest ? { previous: latest.changes } : {}) } : {}),
  };
  sendLog(`🧠 [Memory] tidying ${state.entries.length} entries${feedback ? ' again, with feedback' : ''}`);
  try {
    const result = await askJson({
      basePrompt: buildCuratePrompt(input),
      providerUrl,
      deps: workerDeps(providerUrl),
      timeoutMs: config.responseTimeout,
      validate: (json) => validateCurateReply(json, state.entries),
      buildRepair: (raw, error) => buildCuratePrompt({ ...input, rejected: { raw, error } }),
      onReject: (error, attempt) => sendLog(`🧠 [Memory] tidy proposal rejected (attempt ${attempt}): ${error}`),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
    if (!result.ok || !result.value) return { ok: false, reason: 'failed', error: result.error };
    latest = { id: `curate-${Date.now().toString(36)}`, providerUrl, changes: result.value };
    sendLog(`🧠 [Memory] tidy proposal: ${latest.changes.map((change) => `${change.op} ${change.ids.join('+')}`).join(', ') || 'nothing to change'}`);
    return { ok: true, proposal: latest };
  } catch (err: unknown) {
    if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
    const error = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Memory] tidy failed: ${error}`);
    return { ok: false, reason: 'failed', error };
  } finally {
    if (running === controller) running = null;
  }
}

async function apply(proposalId: unknown, rawPicks: unknown): Promise<MemoryCurateApplyResult> {
  const proposal = latest;
  if (!proposal || proposal.id !== proposalId) return { ok: false, reason: 'expired' };
  const picks = normalizePicks(rawPicks);
  const tally = { applied: 0, skipped: 0, failed: 0 };
  await updateUserMemory((state) => {
    const outcome = applyCuration(state, proposal.changes, picks, new Date().toISOString());
    Object.assign(tally, { applied: outcome.applied, skipped: outcome.skipped, failed: outcome.failed });
    if (outcome.applied === 0) return null;
    // Set before the write, so the change listener sees the memory it describes and keeps it.
    undo = { before: state.entries, after: outcome.state.entries };
    return { state: outcome.state, result: true };
  });
  // A proposal is applied once: its checks were against the memory as it was before.
  latest = null;
  sendLog(`🧠 [Memory] tidy applied ${tally.applied}, skipped ${tally.skipped}, failed ${tally.failed}`);
  return { ok: true, ...tally, undoable: tally.applied > 0 && undo !== null };
}

export function registerMemoryCurateHandlers(): void {
  onUserMemoryChanged((state) => {
    if (undo && !sameEntries(state.entries, undo.after)) undo = null;
  });

  ipcMain.handle(IPC.MEMORY_CURATE_GET_MODEL, (): string => curateModelUrl());

  ipcMain.handle(IPC.MEMORY_CURATE_PROPOSE, (_event, request: MemoryCurateProposeRequest) => propose(request));

  ipcMain.handle(IPC.MEMORY_CURATE_CANCEL, (): boolean => {
    const wasRunning = running !== null;
    running?.abort();
    return wasRunning;
  });

  ipcMain.handle(IPC.MEMORY_CURATE_APPLY, (_event, proposalId: unknown, picks: unknown) => apply(proposalId, picks));

  ipcMain.handle(IPC.MEMORY_CURATE_UNDO, async (): Promise<{ ok: boolean }> => {
    const slot = undo;
    if (!slot) return { ok: false };
    const { result } = await updateUserMemory((state) => {
      const restored = undoCuration(state, slot);
      return restored ? { state: restored, result: true } : null;
    });
    undo = null;
    return { ok: result === true };
  });
}
