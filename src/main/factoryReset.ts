import { app, session } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { config, getDefaultConfig, saveConfig, wipeSensitiveConfig } from './config';
import { applyLaunchAtStartup, sendLog } from './helpers';
import { resetMetrics } from './metrics';
import { getOutputDir } from './files';
import { getFlowDataDir } from './flow';

const FACTORY_RESET_PARTITIONS = [
  'persist:gemini',
  'persist:url-parser',
  'persist:browser-flow',
  'persist:youtube',
] as const;

function getMarkerPath(): string {
  return path.join(app.getPath('userData'), 'factory-reset.pending');
}

export async function requestFactoryReset(): Promise<void> {
  await fs.writeFile(getMarkerPath(), 'pending', 'utf-8');
}

export async function applyPendingFactoryReset(): Promise<void> {
  const marker = getMarkerPath();
  if (!existsSync(marker)) return;
  await fs.rm(marker, { force: true }).catch(() => {});
  sendLog('♻️ Applying scheduled factory reset on a clean boot...');

  try {
    const defaults = getDefaultConfig();
    Object.assign(config, defaults);
    saveConfig(defaults);
    wipeSensitiveConfig();
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    resetMetrics();

    await Promise.all(
      FACTORY_RESET_PARTITIONS.map((partition) =>
        session.fromPartition(partition).clearData().catch(() => {}),
      ),
    );

    await fs.rm(await getOutputDir(), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(getFlowDataDir(), 'flow-checkpoints'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(app.getPath('userData'), 'flow-memory'), { recursive: true, force: true }).catch(() => {});

    sendLog('♻️ Factory reset applied — clean first-run state');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    sendLog(`⚠️ Factory reset hit an error (continuing startup): ${message}`);
  }
}
