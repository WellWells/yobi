import { ipcMain } from 'electron';
import { folderKey, normalizeFolderName } from '../../shared/conversationFolders';
import { FLOW_SORT_MAX_FLOWS, FLOW_SORT_NOTE_MAX_CHARS } from '../../shared/flowFolderSort';
import type {
  FlowSortApplyResult,
  FlowSortPick,
  FlowSortProposal,
  FlowSortProposeRequest,
  FlowSortProposeResult,
  FlowSortUndoResult,
} from '../../shared/flowFolderSort';
import { languageForLocale } from '../../shared/localeLanguage';
import { IPC } from '../../shared/types';
import type { FlowDefinition } from '../../shared/types';
import { config, saveConfig } from '../config';
import { askJson } from '../flow/agent/structuredLlm';
import type { FlowFolderStore } from '../flow/flowFolders';
import { buildSortPrompt, folderExamples, sortSubjects, validateSortReply } from '../flow/flowFolderSort';
import type { SortPromptInput } from '../flow/flowFolderSort';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog } from '../helpers';
import { getLangCache, localizeUserFacingError, t } from '../i18n';
import { ensureWorkerWindow, getWorkerWin } from '../windows';

/**
 * Sorting unfiled flows into folders. The model proposes, the user ticks and renames, and only
 * what they kept is filed — nothing moves on the model's word alone.
 *
 * Main keeps the latest proposal itself; the window sends back only which groups and flows to file
 * and a new folder's name. A flow the user filed elsewhere while reading stays where they put it.
 */

export interface FlowFolderSortDeps {
  /** Every flow, in `flows.json` order. */
  flows: () => FlowDefinition[];
  /** Saves the flows in this order (FlowManager.reorder): their content is left as it is. */
  reorder: (orderedIds: string[]) => Promise<FlowDefinition[]>;
  store: FlowFolderStore;
}

/** What "undo" puts back: where each flow was filed, the folders made for it, the order before. */
interface SortUndo {
  placed: Array<{ id: string; folder: string }>;
  created: string[];
  order: string[];
}

let latest: FlowSortProposal | null = null;
let running: AbortController | null = null;
let undo: SortUndo | null = null;

function sortModelUrl(): string {
  return config.flowSortUrl.trim() || config.targetUrl;
}

/** Remembered only when it differs from what would be used anyway, so "follow the chat model" survives picking it. */
function rememberModel(providerUrl: string): void {
  if (providerUrl === sortModelUrl()) return;
  config.flowSortUrl = providerUrl;
  saveConfig({ flowSortUrl: providerUrl });
}

function clip(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, FLOW_SORT_NOTE_MAX_CHARS) : '';
}

function workerDeps(providerUrl: string): FlowExecutorDeps {
  return {
    getWorkerWin,
    ensureWorkerWin: () => ensureWorkerWindow(providerUrl, 'automation'),
    getTargetUrl: () => providerUrl,
  };
}

function normalizePicks(raw: unknown): FlowSortPick[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): FlowSortPick[] => {
    if (!item || typeof item !== 'object') return [];
    const pick = item as Record<string, unknown>;
    if (typeof pick.key !== 'string' || !pick.key || !Array.isArray(pick.flowIds)) return [];
    const flowIds = pick.flowIds.filter((id): id is string => typeof id === 'string');
    return [{ key: pick.key, flowIds, ...(typeof pick.folder === 'string' ? { folder: pick.folder } : {}) }];
  });
}

function homeIn(folders: ReadonlyArray<{ name: string; flowIds: string[] }>, id: string): string | undefined {
  return folders.find((folder) => folder.flowIds.includes(id))?.name;
}

async function propose(deps: FlowFolderSortDeps, request: FlowSortProposeRequest): Promise<FlowSortProposeResult> {
  const providerUrl = clip(request?.providerUrl) || sortModelUrl();
  rememberModel(providerUrl);
  const flows = deps.flows();
  const folders = await deps.store.list();
  const filed = new Set(folders.flatMap((folder) => folder.flowIds));
  const unfiled = flows.filter((flow) => !filed.has(flow.id));
  if (unfiled.length === 0) return { ok: false, reason: 'empty' };

  running?.abort();
  const controller = new AbortController();
  running = controller;
  const subjects = sortSubjects(unfiled.slice(0, FLOW_SORT_MAX_FLOWS));
  const keyOf = new Map(subjects.map((subject) => [subject.flow.id, subject.key]));
  const instruction = clip(request?.instruction);
  const feedback = clip(request?.feedback);
  const previous = feedback && latest
    ? latest.groups.map((group) => ({
      folder: group.folder,
      flows: group.flowIds.map((id) => keyOf.get(id)).filter((key): key is string => Boolean(key)),
    }))
    : undefined;
  const input: SortPromptInput = {
    subjects,
    folders: folderExamples(folders, flows),
    language: languageForLocale(config.locale),
    ...(instruction ? { instruction } : {}),
    ...(feedback ? { feedback, ...(previous ? { previous } : {}) } : {}),
  };
  const existing = folders.map((folder) => folder.name);
  sendLog(`🗂️ [Flow] sorting ${subjects.length} unfiled flows into folders${feedback ? ' again, with feedback' : ''}`);
  try {
    const result = await askJson({
      basePrompt: buildSortPrompt(input),
      providerUrl,
      deps: workerDeps(providerUrl),
      timeoutMs: config.responseTimeout,
      validate: (json) => validateSortReply(json, subjects, existing),
      buildRepair: (raw, error) => buildSortPrompt({ ...input, rejected: { raw, error } }),
      onReject: (error, attempt) => sendLog(`🗂️ [Flow] folder proposal rejected (attempt ${attempt}): ${error}`),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
    if (!result.ok || !result.value) {
      // The validator's text is the repair instruction written for the model; the log keeps it.
      sendLog(`⚠️ [Flow] folder sort failed: ${result.error ?? 'no usable proposal'}`);
      return { ok: false, reason: 'failed', error: t(getLangCache(), 'flow.folder.sort.invalidOutput') };
    }
    latest = {
      id: `sort-${Date.now().toString(36)}`,
      providerUrl,
      groups: result.value.groups,
      leftOver: result.value.leftOver,
      notSent: Math.max(0, unfiled.length - subjects.length),
    };
    sendLog(`🗂️ [Flow] folder proposal: ${latest.groups.map((group) => `${group.isNew ? 'new' : 'existing'} folder × ${group.flowIds.length}`).join(', ') || 'nothing to file'}`);
    return { ok: true, proposal: latest };
  } catch (err: unknown) {
    if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
    const error = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Flow] folder sort failed: ${error}`);
    return { ok: false, reason: 'failed', error: localizeUserFacingError(error, getLangCache()) };
  } finally {
    if (running === controller) running = null;
  }
}

async function apply(deps: FlowFolderSortDeps, proposalId: unknown, rawPicks: unknown): Promise<FlowSortApplyResult> {
  const proposal = latest;
  if (!proposal || proposal.id !== proposalId) return { ok: false, reason: 'expired' };
  // A proposal is applied once: it was made against the folders as they were then.
  latest = null;
  const picks = normalizePicks(rawPicks);
  const order = deps.flows().map((flow) => flow.id);
  const known = new Set(order);
  const tally = { moved: 0, skipped: 0, failed: 0 };
  const filledFolders = new Set<string>();
  const placed: SortUndo['placed'] = [];
  const created: string[] = [];
  let flows: FlowDefinition[] | undefined;

  for (const pick of picks) {
    const group = proposal.groups.find((each) => each.key === pick.key);
    if (!group) continue;
    const wanted = [...new Set(pick.flowIds)].filter((id) => group.flowIds.includes(id));
    if (wanted.length === 0) continue;
    const current = await deps.store.list();
    const ids = wanted.filter((id) => known.has(id) && homeIn(current, id) === undefined);
    tally.skipped += wanted.length - ids.length;
    if (ids.length === 0) continue;
    const name = group.isNew && pick.folder !== undefined ? normalizeFolderName(pick.folder) : group.folder;
    let target = current.find((folder) => folderKey(folder.name) === folderKey(name))?.name;
    if (!target) {
      const made = await deps.store.create(name).catch(() => null);
      if (!made?.ok || !made.name) {
        sendLog(`⚠️ [Flow] could not make a folder for sorted flows: ${made?.error ?? 'failed'}`);
        tally.failed += ids.length;
        continue;
      }
      target = made.name;
      created.push(target);
    }
    const moved = await deps.store.move(ids, target).catch(() => null);
    if (!moved?.ok) {
      tally.failed += ids.length;
      continue;
    }
    if (moved.flows) flows = moved.flows;
    tally.moved += ids.length;
    filledFolders.add(folderKey(target));
    placed.push(...ids.map((id) => ({ id, folder: target! })));
  }
  undo = placed.length > 0 ? { placed, created, order } : null;
  sendLog(`🗂️ [Flow] sorted ${tally.moved} flows into ${filledFolders.size} folders, skipped ${tally.skipped}, failed ${tally.failed}`);
  return { ok: true, ...tally, folders: filledFolders.size, ...(flows ? { flows } : {}), undoable: undo !== null };
}

/**
 * Takes back the last sort: flows still in the folder it put them in go back to the top level,
 * folders it made that are now empty go, and the order is put back when no flow came or went.
 */
async function undoSort(deps: FlowFolderSortDeps): Promise<FlowSortUndoResult> {
  const slot = undo;
  undo = null;
  if (!slot) return { ok: false };
  const current = await deps.store.list();
  const back = slot.placed
    .filter((entry) => {
      const home = homeIn(current, entry.id);
      return home !== undefined && folderKey(home) === folderKey(entry.folder);
    })
    .map((entry) => entry.id);
  let flows: FlowDefinition[] | undefined;
  if (back.length > 0) {
    const moved = await deps.store.move(back, '');
    if (!moved.ok) return { ok: false };
    flows = moved.flows;
  }
  const after = await deps.store.list();
  for (const name of slot.created) {
    const folder = after.find((each) => folderKey(each.name) === folderKey(name));
    if (folder && folder.flowIds.length === 0) await deps.store.remove(folder.name);
  }
  const now = deps.flows().map((flow) => flow.id);
  const sameFlows = now.length === slot.order.length && slot.order.every((id) => now.includes(id));
  if (sameFlows && now.some((id, index) => id !== slot.order[index])) flows = await deps.reorder(slot.order);
  return { ok: true, ...(flows ? { flows } : {}) };
}

export function registerFlowFolderSortHandlers(deps: FlowFolderSortDeps): void {
  ipcMain.handle(IPC.FLOW_FOLDER_SORT_GET_MODEL, (): string => sortModelUrl());

  ipcMain.handle(IPC.FLOW_FOLDER_SORT_PROPOSE, (_event, request: FlowSortProposeRequest) => propose(deps, request));

  ipcMain.handle(IPC.FLOW_FOLDER_SORT_CANCEL, (): boolean => {
    const wasRunning = running !== null;
    running?.abort();
    return wasRunning;
  });

  ipcMain.handle(IPC.FLOW_FOLDER_SORT_APPLY, (_event, proposalId: unknown, picks: unknown) => apply(deps, proposalId, picks));

  ipcMain.handle(IPC.FLOW_FOLDER_SORT_UNDO, (): Promise<FlowSortUndoResult> => undoSort(deps).catch((err: unknown) => {
    sendLog(`⚠️ [Flow] could not undo the folder sort: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false };
  }));
}
