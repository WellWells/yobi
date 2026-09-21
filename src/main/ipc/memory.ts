import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { normalizeMemoryNotes } from '../../shared/userMemory';
import type { MemoryEditFailure, MemoryEditResult, UserMemoryBotSelf, UserMemorySnapshot } from '../../shared/userMemory';
import { sendLog, sendToRenderer } from '../helpers';
import {
  addMemoryEntry,
  editMemoryEntry,
  loadUserMemory,
  memorySnapshot,
  onUserMemoryChanged,
  removeMemoryEntry,
  undoMemoryNote,
  updateUserMemory,
} from '../memory';
import type { MemoryStateOutcome, UserMemoryState } from '../memory';

async function edit(apply: (state: UserMemoryState) => MemoryStateOutcome): Promise<MemoryEditResult> {
  const refused: { reason: MemoryEditFailure | null } = { reason: null };
  const { state } = await updateUserMemory((current) => {
    const outcome = apply(current);
    if (!outcome.ok) {
      refused.reason = outcome.reason;
      return null;
    }
    return { state: outcome.state, result: true };
  });
  const snapshot = memorySnapshot(state);
  return refused.reason ? { ok: false, reason: refused.reason, snapshot } : { ok: true, snapshot };
}

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

export function registerMemoryHandlers(): void {
  onUserMemoryChanged((state) => sendToRenderer(IPC.MEMORY_CHANGED, memorySnapshot(state)));

  ipcMain.handle(IPC.MEMORY_GET, async (): Promise<UserMemorySnapshot> => memorySnapshot(await loadUserMemory()));

  ipcMain.handle(IPC.MEMORY_SET_ENABLED, async (_event, enabled: boolean): Promise<UserMemorySnapshot> => {
    const { state } = await updateUserMemory((current) => ({ state: { ...current, enabled: enabled === true }, result: true }));
    sendLog(`🧠 [Memory] ${state.enabled ? 'enabled' : 'disabled'}`);
    return memorySnapshot(state);
  });

  ipcMain.handle(IPC.MEMORY_ADD, (_event, text: string) => edit((state) => addMemoryEntry(
    state,
    String(text ?? ''),
    { source: 'manual', now: new Date().toISOString() },
  )));

  ipcMain.handle(IPC.MEMORY_UPDATE, (_event, id: string, text: string) => edit((state) => editMemoryEntry(
    state,
    String(id ?? ''),
    String(text ?? ''),
    { now: new Date().toISOString(), byUser: true },
  )));

  ipcMain.handle(IPC.MEMORY_DELETE, (_event, id: string) => edit((state) => removeMemoryEntry(state, String(id ?? ''))));

  // The id counter is kept: an old conversation may still name an id, and it must not start
  // pointing at whatever the user tells Yobi next.
  ipcMain.handle(IPC.MEMORY_CLEAR, async (): Promise<UserMemorySnapshot> => {
    const { state } = await updateUserMemory((current) => (
      current.entries.length === 0 ? null : { state: { ...current, entries: [] }, result: true }
    ));
    return memorySnapshot(state);
  });

  ipcMain.handle(IPC.MEMORY_UNDO, async (_event, rawNote: unknown): Promise<{ ok: boolean; snapshot: UserMemorySnapshot }> => {
    const [note] = normalizeMemoryNotes([rawNote]);
    const { state, result } = await updateUserMemory((current) => {
      const next = note ? undoMemoryNote(current, note, new Date().toISOString()) : null;
      return next ? { state: next, result: true } : null;
    });
    return { ok: result === true, snapshot: memorySnapshot(state) };
  });

  ipcMain.handle(IPC.MEMORY_SET_BOT_SELF, async (_event, raw: Partial<UserMemoryBotSelf>): Promise<UserMemorySnapshot> => {
    const botSelf: UserMemoryBotSelf = { telegram: idList(raw?.telegram), line: idList(raw?.line) };
    const { state } = await updateUserMemory((current) => ({ state: { ...current, botSelf }, result: true }));
    return memorySnapshot(state);
  });
}
