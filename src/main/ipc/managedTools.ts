import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { MANAGED_TOOL_ROWS, isManagedToolId } from '../../shared/managedTools';
import type { ManagedToolState } from '../../shared/managedTools';
import { errorText } from '../../shared/errorText';
import { sendLog, sendToRenderer } from '../helpers';
import {
  checkManagedToolUpdate, installManagedTool, managedToolState, onManagedToolState, removeManagedTool, resolveTool,
  setManagedToolCustomPath,
} from '../managedTools';

const MAX_PATH_CHARS = 1_024;

/** A custom path from the settings page, `null` (clear), or undefined for anything else. */
export function parseCustomToolPath(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const file = raw.trim().replace(/^"(.*)"$/, '$1');
  return file && file.length <= MAX_PATH_CHARS ? file : undefined;
}

/** Every tool's state, after looking each one up again (the card shows a copy installed meanwhile). */
async function allStates(): Promise<ManagedToolState[]> {
  for (const { id } of MANAGED_TOOL_ROWS) {
    await resolveTool(id, { fresh: true }).catch((err) => sendLog(`⚠️ [Tools] Looking up ${id} failed: ${errorText(err)}`));
  }
  return MANAGED_TOOL_ROWS.map(({ id }) => managedToolState(id));
}

/**
 * Managed only from this computer's own window, like the download tools: nothing a bot message,
 * a flow step or the agent sends reaches these handlers, so no chat installs a program or points
 * Yobi at one.
 */
export function registerManagedToolHandlers(): void {
  onManagedToolState((state) => sendToRenderer(IPC.MANAGED_TOOLS_STATE, state));

  ipcMain.handle(IPC.MANAGED_TOOLS_GET, () => allStates());

  ipcMain.handle(IPC.MANAGED_TOOLS_INSTALL, async (_event, id: unknown) => {
    if (isManagedToolId(id)) await installManagedTool(id);
    return allStates();
  });

  ipcMain.handle(IPC.MANAGED_TOOLS_CHECK_UPDATE, async (_event, id: unknown) => {
    if (isManagedToolId(id)) await checkManagedToolUpdate(id, { force: true });
    return allStates();
  });

  ipcMain.handle(IPC.MANAGED_TOOLS_REMOVE, async (_event, id: unknown) => {
    if (isManagedToolId(id)) {
      await removeManagedTool(id).catch((err) => sendLog(`⚠️ [Tools] Removing ${id} failed: ${errorText(err)}`));
    }
    return allStates();
  });

  ipcMain.handle(IPC.MANAGED_TOOLS_SET_CUSTOM, async (_event, id: unknown, raw: unknown) => {
    const file = parseCustomToolPath(raw);
    if (isManagedToolId(id) && file !== undefined) await setManagedToolCustomPath(id, file);
    return allStates();
  });
}
