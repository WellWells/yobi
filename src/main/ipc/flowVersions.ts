import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { isHistoryFlowId } from '../../shared/flowVersions';
import type { FlowVersionList, FlowVersionRestoreResult } from '../../shared/flowVersions';
import { isVersionId } from '../../shared/conversationHistory';
import { sendLog } from '../helpers';
import { deleteFlowVersion, deleteFlowVersions } from '../flow/flowVersions';
import type { IpcContext } from './context';

/** The flow editor's ⋮ "Version history": list, restore, delete one, delete all. */
export function registerFlowVersionHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.FLOW_VERSIONS_LIST, async (_event, flowId: unknown): Promise<FlowVersionList> => {
    if (!ctx.flowManager || !isHistoryFlowId(flowId)) return { ok: false };
    const versions = await ctx.flowManager.listVersions(flowId).catch(() => null);
    return versions ? { ok: true, versions } : { ok: false };
  });

  ipcMain.handle(IPC.FLOW_VERSION_RESTORE, async (_event, flowId: unknown, vid: unknown): Promise<FlowVersionRestoreResult> => {
    if (!ctx.flowManager || !isHistoryFlowId(flowId) || !isVersionId(vid)) return { ok: false, reason: 'missing' };
    try {
      return await ctx.flowManager.restoreVersion(flowId, vid);
    } catch (err: unknown) {
      sendLog(`⚠️ [Flow] Could not restore the version: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });

  ipcMain.handle(IPC.FLOW_VERSION_DELETE, async (_event, flowId: unknown, vid: unknown): Promise<boolean> => {
    if (!isHistoryFlowId(flowId) || !isVersionId(vid)) return false;
    return deleteFlowVersion(flowId, vid).catch(() => false);
  });

  ipcMain.handle(IPC.FLOW_VERSIONS_CLEAR, async (_event, flowId: unknown): Promise<boolean> => {
    if (!isHistoryFlowId(flowId)) return false;
    return deleteFlowVersions([flowId]).then(() => true, () => false);
  });
}
