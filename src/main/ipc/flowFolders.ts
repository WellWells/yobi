import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { FlowFolderDeleteResult, FlowFolderMoveResult, FlowFolderResult } from '../../shared/flowFolders';
import type { FlowFolderRunState } from '../../shared/flowFolderRun';
import { folderKey } from '../../shared/conversationFolders';
import { sendLog, sendToRenderer, sendWebNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import { getFlowDataDir } from '../flow/paths';
import { configureFlowFolders } from '../flow/flowFolders';
import type { FlowFolderStore } from '../flow/flowFolders';
import { FlowFolderRunner } from '../flow/flowFolderRun';
import type { IpcContext } from './context';

const FAILED = { ok: false, error: 'failed' } as const;

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

async function guarded<T>(what: string, failed: T, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err: unknown) {
    sendLog(`⚠️ [Flow] Could not ${what} a flow folder: ${err instanceof Error ? err.message : String(err)}`);
    return failed;
  }
}

/** The flow sidebar's folders: list, make, rename, delete, file flows. */
export function registerFlowFolderHandlers(ctx: IpcContext): FlowFolderStore {
  const { flowManager } = ctx;
  const store = configureFlowFolders({
    dir: getFlowDataDir,
    flowOrder: () => flowManager?.getAll().map((flow) => flow.id) ?? [],
    reorder: async (ids) => (flowManager ? flowManager.reorder(ids) : []),
    broadcast: (folders) => sendToRenderer(IPC.FLOW_FOLDERS_CHANGED, folders),
    log: sendLog,
  });

  ipcMain.handle(IPC.FLOW_FOLDER_LIST, () => store.list().catch(() => []));

  ipcMain.handle(IPC.FLOW_FOLDER_CREATE, (_event, name: unknown, restoreIds: unknown): Promise<FlowFolderResult> | FlowFolderResult => {
    if (typeof name !== 'string' || (restoreIds !== undefined && !isStringList(restoreIds))) return FAILED;
    return guarded<FlowFolderResult>('make', FAILED, () => store.create(name, restoreIds));
  });

  ipcMain.handle(IPC.FLOW_FOLDER_RENAME, (_event, from: unknown, to: unknown): Promise<FlowFolderResult> | FlowFolderResult => {
    if (typeof from !== 'string' || typeof to !== 'string') return FAILED;
    return guarded<FlowFolderResult>('rename', FAILED, () => store.rename(from, to));
  });

  ipcMain.handle(IPC.FLOW_FOLDER_DELETE, (_event, name: unknown): Promise<FlowFolderDeleteResult> | FlowFolderDeleteResult => {
    const failed: FlowFolderDeleteResult = { ok: false, flowIds: [], error: 'failed' };
    if (typeof name !== 'string') return failed;
    return guarded('delete', failed, () => store.remove(name));
  });

  ipcMain.handle(IPC.FLOW_FOLDER_MOVE, (_event, flowIds: unknown, folder: unknown, before: unknown): Promise<FlowFolderMoveResult> | FlowFolderMoveResult => {
    if (!isStringList(flowIds) || typeof folder !== 'string' || (before !== undefined && before !== null && typeof before !== 'string')) return FAILED;
    return guarded<FlowFolderMoveResult>('move flows into', FAILED, () => store.move(flowIds, folder, before ?? undefined));
  });

  const runner = new FlowFolderRunner({
    folderFlows: async (folder) => {
      const found = (await store.list()).find((entry) => folderKey(entry.name) === folderKey(folder));
      if (!found || !flowManager) return found ? [] : null;
      const inside = new Set(found.flowIds);
      return flowManager.getAll().filter((flow) => inside.has(flow.id));
    },
    flowById: (flowId) => flowManager?.getAll().find((flow) => flow.id === flowId),
    isBusy: (flowId) => flowManager?.isQueuedOrRunning(flowId) ?? false,
    run: (flowId, signal) => {
      if (!flowManager) return Promise.reject(new Error('FlowManager not available'));
      return flowManager.queueExecutionWithId(flowId, undefined, 'ui', undefined, signal).result;
    },
    broadcast: (states) => sendToRenderer(IPC.FLOW_FOLDER_RUN_CHANGED, states),
    notifyDone: (state) => notifyFolderRunDone(state, (flowId) => flowManager?.getAll().find((flow) => flow.id === flowId)?.name ?? ''),
    log: sendLog,
  });

  ipcMain.handle(IPC.FLOW_FOLDER_RUN, (_event, folder: unknown) => {
    if (typeof folder !== 'string') return { ok: false, reason: 'unknownFolder' };
    return runner.start(folder).catch((err: unknown) => {
      sendLog(`⚠️ [Flow] Could not run a flow folder: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'unknownFolder' };
    });
  });
  ipcMain.handle(IPC.FLOW_FOLDER_RUN_STOP, (_event, folder: unknown) => (typeof folder === 'string' ? runner.stop(folder) : false));
  ipcMain.handle(IPC.FLOW_FOLDER_RUN_LIST, () => runner.list());

  return store;
}

/** One notice for the whole batch: the flows' own notices still say what each did. */
function notifyFolderRunDone(state: FlowFolderRunState, nameOf: (flowId: string) => string): void {
  const strings = getLangCache();
  const title = t(strings, 'notify.flowFolder.done.title', { folder: state.folder });
  if (state.failed.length === 0) {
    sendWebNotification(title, t(strings, 'notify.flowFolder.done.allOk', { count: String(state.succeeded.length) }), 'success');
    return;
  }
  const names = state.failed.map(nameOf).filter(Boolean).join(t(strings, 'flow.folder.sort.nameSeparator'));
  sendWebNotification(title, t(strings, 'notify.flowFolder.done.someFailed', {
    ok: String(state.succeeded.length),
    failed: String(state.failed.length),
    names,
  }), 'warning');
}
