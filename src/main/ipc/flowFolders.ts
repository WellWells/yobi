import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { FlowFolderDeleteResult, FlowFolderMoveResult, FlowFolderResult } from '../../shared/flowFolders';
import { sendLog, sendToRenderer } from '../helpers';
import { getFlowDataDir } from '../flow/paths';
import { configureFlowFolders } from '../flow/flowFolders';
import type { FlowFolderStore } from '../flow/flowFolders';
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

  return store;
}
