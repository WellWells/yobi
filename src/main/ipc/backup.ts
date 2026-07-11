import { ipcMain, app } from 'electron';
import * as path from 'node:path';
import { IPC } from '../../shared/types';
import type {
  BackupCategoryId,
  BackupExportResult,
  BackupImportResult,
  SettingsSnapshot,
} from '../../shared/types';
import {
  buildBackupBaseName,
  buildBackupZip,
  getCategoryInfos,
  inspectBackup,
  applyBackup,
} from '../backup';
import { sendLog, sendToRenderer } from '../helpers';
import { listOutputFiles } from '../files';
import { buildSettingsSnapshot, showSaveDialogForWin } from './context';
import { applyImportedConfigLiveEffects } from './settings';
import type { IpcContext } from './context';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

export function registerBackupHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.BACKUP_CATEGORIES, () => getCategoryInfos());

  ipcMain.handle(
    IPC.BACKUP_EXPORT,
    async (_event, categories: BackupCategoryId[], namePrefix?: string): Promise<BackupExportResult> => {
      try {
        const requested = Array.isArray(categories) ? categories : [];
        if (requested.length === 0) return { ok: false, error: 'empty' };

        const baseName = buildBackupBaseName(namePrefix?.trim() || undefined);
        const defaultPath = path.join(app.getPath('documents'), `${baseName}.zip`);
        const result = await showSaveDialogForWin(ctx.getMainWin(), {
          defaultPath,
          filters: [{ name: 'Zip', extensions: ['zip'] }],
        });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };

        const included = await buildBackupZip(requested, result.filePath);
        sendLog(`💾 Backup exported (${included.join(', ') || 'nothing'}) → ${result.filePath}`);
        return { ok: included.length > 0, path: result.filePath };
      } catch (err: unknown) {
        const message = errMsg(err);
        sendLog(`⚠️ Backup export failed: ${message}`);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(IPC.BACKUP_INSPECT, (_event, zipPath: string) => inspectBackup(zipPath));

  ipcMain.handle(
    IPC.BACKUP_IMPORT,
    async (_event, zipPath: string, categories: BackupCategoryId[]): Promise<BackupImportResult> => {
      try {
        const requested = Array.isArray(categories) ? categories : [];
        if (!zipPath || requested.length === 0) return { ok: false, restored: [], error: 'empty' };

        const { restored, importedConfig } = await applyBackup(zipPath, requested, {
          reloadFlows: async () => {
            if (ctx.flowManager) await ctx.flowManager.reload();
          },
        });

        let snapshot: SettingsSnapshot | undefined;
        if (importedConfig) {
          applyImportedConfigLiveEffects(importedConfig, ctx);
          snapshot = buildSettingsSnapshot();
        }
        if (restored.includes('outputs')) {
          sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
        }

        sendLog(`📥 Backup restored: ${restored.join(', ') || 'nothing'}`);
        return { ok: restored.length > 0, restored, snapshot };
      } catch (err: unknown) {
        const message = errMsg(err);
        sendLog(`⚠️ Backup restore failed: ${message}`);
        return { ok: false, restored: [], error: message };
      }
    },
  );
}
