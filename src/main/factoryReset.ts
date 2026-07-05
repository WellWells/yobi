import { app, session } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { config, getDefaultConfig, saveConfig } from './config';
import { applyLaunchAtStartup, sendLog } from './helpers';
import { getOutputDir } from './files';
import { getFlowDataDir } from './flow';

// Every persistent Chromium session partition the app writes to. A no-arg
// clearData() on each wipes cookies (= logout of every AI provider, which all
// share persist:gemini), HTTP cache, localStorage/IndexedDB/serviceWorkers —
// the superset of the per-origin clearProviderSession() used for single-account
// logout. Kept in sync with the session.fromPartition() call sites in the app.
const FACTORY_RESET_PARTITIONS = [
  'persist:gemini',
  'persist:url-parser',
  'persist:browser-flow',
  'persist:youtube',
] as const;

function getMarkerPath(): string {
  return path.join(app.getPath('userData'), 'factory-reset.pending');
}

// Schedule a factory reset for the next boot. The actual wipe runs in
// applyPendingFactoryReset() on the following (pristine) launch — see the note
// there for why it must not run in the current, in-flight process.
export async function requestFactoryReset(): Promise<void> {
  await fs.writeFile(getMarkerPath(), 'pending', 'utf-8');
}

// Apply a pending factory reset, if one was scheduled. MUST be called very early
// in app startup — before the worker/main windows, the task queue, the flow
// manager and the Telegram bot exist — so nothing can resurrect what we delete:
// a running task/flow re-writing an output/checkpoint, or (worst) a flow
// re-navigating the shared worker and re-persisting provider cookies AFTER the
// logout. In a just-started process there is no such in-flight work, so the wipe
// is race-free. AgentFlow flows (flows.json) are intentionally PRESERVED; to also
// wipe them for exact first-run parity, add `await saveFlowsToDisk([])` (exported
// from './flow') alongside the flow-checkpoints removal below.
export async function applyPendingFactoryReset(): Promise<void> {
  const marker = getMarkerPath();
  if (!existsSync(marker)) return;
  // Remove the marker first so a locked/failed wipe can never cause a boot loop.
  await fs.rm(marker, { force: true }).catch(() => {});
  sendLog('♻️ Applying scheduled factory reset on a clean boot...');

  // Never throw: this runs inside app.whenReady before the windows are created,
  // so a rejection here would abort startup entirely. Best-effort each step.
  try {
    // 1. Settings -> defaults. store.store= is a full-file replace, so this zeroes
    //    every field including the encrypted Telegram token / SMTP password / BYOK
    //    keys and the Telegram pairing list. Runs before initSensitiveConfig() so
    //    the (now-empty) secrets decrypt to ''.
    const defaults = getDefaultConfig();
    Object.assign(config, defaults);
    saveConfig(defaults);
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);

    // 2. Log out of every AI provider + drop all browser caches. No window uses
    //    these partitions yet this early in boot, so there is no live page to
    //    re-persist a cookie after the wipe.
    await Promise.all(
      FACTORY_RESET_PARTITIONS.map((partition) =>
        session.fromPartition(partition).clearData().catch(() => {}),
      ),
    );

    // 3. Delete saved history + all generated files + flow caches/memory. A whole-
    //    dir removal (getOutputDir re-creates it empty on next read) — unlike the
    //    "Clear history" action which only unlinks .md and leaves images/PDFs/
    //    downloads behind. flow-memory always lives under userData even in dev.
    await fs.rm(await getOutputDir(), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(getFlowDataDir(), 'flow-checkpoints'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(app.getPath('userData'), 'flow-memory'), { recursive: true, force: true }).catch(() => {});

    sendLog('♻️ Factory reset applied — clean first-run state');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    sendLog(`⚠️ Factory reset hit an error (continuing startup): ${message}`);
  }
}
