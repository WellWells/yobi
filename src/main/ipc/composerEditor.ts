import { app, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { IPC } from '../../shared/types';
import type { ComposerEditorEventPayload, ExternalEditorSettings } from '../../shared/types';
import { config, saveConfig } from '../config';
import { getMainWindow, sendLog, sendToRenderer } from '../helpers';
import { openEditorSession, type EditorSession } from '../externalEditor';
import { editorChoiceFor, editorSettingsSnapshot, normalizeEditorChoice } from '../editorPresets';

/** One composer, one draft in an editor: opening again drops the previous one. */
let active: { id: string; session: EditorSession } | null = null;

async function dropActive(): Promise<void> {
  const previous = active;
  active = null;
  await previous?.session.finish();
}

/** Closing the editor hands the draft back, so Yobi comes forward the way a terminal would. */
function returnToComposer(): void {
  const win = getMainWindow();
  if (!win || win.isMinimized() || win.isFocused()) return;
  // A window of a background app cannot become key on macOS until the app is active again.
  // The user just closed the editor to come back, so this is the one place taking focus is asked for.
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
}

export function registerComposerEditorHandlers(): void {
  ipcMain.handle(IPC.COMPOSER_EDITOR_OPEN, async (_event, text: unknown): Promise<string | null> => {
    if (typeof text !== 'string') return null;
    await dropActive();
    const id = randomUUID();
    // Read at every press, so a change in Settings applies to the next Ctrl+G.
    const choice = editorChoiceFor(config.externalEditor, config.externalEditorCommand);
    if (config.externalEditor && config.externalEditor !== 'custom' && choice.kind === 'auto') {
      sendLog(`⚠️ External editor "${config.externalEditor}" not found — using the automatic choice`);
    }
    try {
      const session = await openEditorSession(text, (event) => {
        if (event.kind !== 'saved' && active?.id === id) active = null;
        if (event.kind === 'failed') sendLog(`⚠️ External editor failed: ${event.detail}`);
        if (event.kind === 'closed') returnToComposer();
        const payload: ComposerEditorEventPayload = { id, ...event };
        sendToRenderer(IPC.COMPOSER_EDITOR_EVENT, payload);
      }, { choice });
      // A launch that failed on the spot has already reported, before this id reached the composer.
      if (!session.isOpen()) return null;
      active = { id, session };
      return id;
    } catch (err: unknown) {
      sendLog(`⚠️ External editor failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  ipcMain.handle(IPC.COMPOSER_EDITOR_FINISH, async (_event, id: unknown): Promise<string | null> => {
    if (!active || active.id !== id) return null;
    const { session } = active;
    active = null;
    return session.finish();
  });

  ipcMain.handle(IPC.COMPOSER_EDITOR_SETTINGS_GET, (): ExternalEditorSettings =>
    editorSettingsSnapshot(config.externalEditor, config.externalEditorCommand));

  ipcMain.handle(IPC.COMPOSER_EDITOR_SETTINGS_SET, (_event, update: unknown): ExternalEditorSettings => {
    const next = update && typeof update === 'object' ? update as { choice?: unknown; command?: unknown } : {};
    config.externalEditor = normalizeEditorChoice(next.choice);
    if (typeof next.command === 'string') config.externalEditorCommand = next.command.trim();
    saveConfig({ externalEditor: config.externalEditor, externalEditorCommand: config.externalEditorCommand });
    return editorSettingsSnapshot(config.externalEditor, config.externalEditorCommand);
  });

  // The draft may be private; it does not outlive the app in the temp folder.
  app.on('will-quit', () => {
    if (!active) return;
    rmSync(path.dirname(active.session.file), { recursive: true, force: true });
    active = null;
  });
}
