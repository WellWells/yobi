import type { BrowserWindow, WebContents } from 'electron';
import { config, normalizePerplexityModelChoice, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { isProviderHost, navigateAndWait, sleep } from './common';
import { countElements, executeWithTimeout } from './automationExecutor';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import { needsModelCatalogRestamp } from '../../shared/modelCatalogFreshness';
import {
  EMPTY_PERPLEXITY_CHOICE,
  perplexitySnapshotToCatalog,
  resolvePerplexityTarget,
  samePerplexityCatalogContent,
  samePerplexityChoice,
} from '../../shared/perplexityModels';
import type {
  PerplexityModelChoice,
  PerplexityModelState,
  PerplexityPickerSnapshot,
  PerplexityPickerTarget,
} from '../../shared/perplexityModels';
import { PERPLEXITY_MODEL_TRIGGER_SELECTOR, buildPerplexityModelPickerScript } from './perplexityModelScript';
import type { PerplexityPickerResult } from './perplexityModelScript';
import { isPerplexitySignedIn } from './perplexitySession';

/** Opening, choosing and re-reading takes about a second; this only stops a hang. */
const PICKER_TIMEOUT_MS = 15_000;

export function getPerplexityModelState(): PerplexityModelState {
  return { catalog: config.perplexityModelCatalog, choice: config.perplexityModel };
}

function publish(): void {
  sendToRenderer(IPC.PERPLEXITY_MODEL_CHANGED, getPerplexityModelState());
}

export function setPerplexityModelChoice(patch: Partial<PerplexityModelChoice>): PerplexityModelState {
  const next = normalizePerplexityModelChoice({ ...config.perplexityModel, ...patch });
  if (!samePerplexityChoice(next, config.perplexityModel)) {
    config.perplexityModel = next;
    saveConfig({ perplexityModel: next });
    publish();
  }
  return getPerplexityModelState();
}

/** Signed out, or a different account: the cached rows belong to someone else's plan. */
export function clearPerplexityModels(): void {
  if (!config.perplexityModelCatalog && samePerplexityChoice(config.perplexityModel, EMPTY_PERPLEXITY_CHOICE)) return;
  config.perplexityModel = EMPTY_PERPLEXITY_CHOICE;
  config.perplexityModelCatalog = null;
  saveConfig({ perplexityModel: EMPTY_PERPLEXITY_CHOICE, perplexityModelCatalog: null });
  publish();
}

async function runPicker(wc: WebContents, target: PerplexityPickerTarget | null): Promise<PerplexityPickerResult> {
  return executeWithTimeout<PerplexityPickerResult>(wc, buildPerplexityModelPickerScript(target), PICKER_TIMEOUT_MS);
}

/** Keeps the cached list and the setting in step with what the page just showed. */
function remember(snapshot: PerplexityPickerSnapshot, choice: PerplexityModelChoice): void {
  // A read without rows keeps the last good list: a menu that renders nothing is not news.
  const catalog = snapshot.models.length > 0
    ? perplexitySnapshotToCatalog(snapshot, new Date().toISOString())
    : config.perplexityModelCatalog;
  const catalogChanged = !samePerplexityCatalogContent(config.perplexityModelCatalog, catalog);
  const choiceChanged = !samePerplexityChoice(config.perplexityModel, choice);
  const restamp = snapshot.models.length > 0 && needsModelCatalogRestamp(config.perplexityModelCatalog);
  if (!catalogChanged && !choiceChanged && !restamp) return;
  config.perplexityModelCatalog = catalog;
  config.perplexityModel = choice;
  saveConfig({ perplexityModelCatalog: catalog, perplexityModel: choice });
  if (catalogChanged) sendLog(`🧠 Perplexity model list updated: ${catalog?.models.map((m) => m.label).join(' / ')}`);
  publish();
}

function selectedLabel(snapshot: PerplexityPickerSnapshot): string {
  return snapshot.models.find((m) => m.selected)?.label ?? 'its own choice';
}

/**
 * Makes Perplexity's menu match Yobi's Perplexity setting, refreshing the cached list on the way.
 * A visitor has no model to choose, so nothing is opened for one.
 *
 * Never throws, and never forces a choice the page does not show: a menu that moved, lists
 * nothing or no longer has the chosen model leaves the page on its own selection, the send goes
 * ahead on it and the log says so.
 */
export async function syncPerplexityModel(wc: WebContents): Promise<void> {
  try {
    if (!(await isPerplexitySignedIn(wc.session))) return;
    const read = await runPicker(wc, null);
    if (!read.ok) {
      sendLog(`⚠️ Perplexity model menu unavailable (${read.reason}) — sending with the page's current model`);
      return;
    }
    if (read.snapshot.models.length === 0) {
      sendLog('⚠️ Perplexity\'s model menu listed no model to choose — the page may have changed; sending with its current model');
      return;
    }
    const decision = resolvePerplexityTarget(config.perplexityModel, read.snapshot);
    if (decision.unavailable) {
      sendLog(`🧠 Perplexity no longer offers ${decision.unavailable} — leaving the page on ${selectedLabel(read.snapshot)}`);
    }

    let snapshot = read.snapshot;
    const { target } = decision;
    if (target.modelId !== null) {
      const applied = await runPicker(wc, target);
      if (!applied.ok) {
        sendLog(`⚠️ Could not switch the Perplexity model (${applied.reason}) — sending with ${selectedLabel(snapshot)}`);
        remember(snapshot, decision.choice);
        return;
      }
      snapshot = applied.snapshot;
      sendLog(snapshot.models.some((m) => m.id === target.modelId && m.selected)
        ? `🧠 Perplexity switched to ${selectedLabel(snapshot)}`
        : `⚠️ Perplexity did not take the switch — sending with ${selectedLabel(snapshot)}`);
    }
    remember(snapshot, decision.choice);
  } catch (err) {
    sendLog(`⚠️ Perplexity model sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function waitForPicker(wc: WebContents, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (await countElements(wc, PERPLEXITY_MODEL_TRIGGER_SELECTOR)) === 0) {
    await sleep(200);
  }
}

/**
 * For a list that is missing or stale: loads Perplexity just far enough to read its menu. Only a
 * signed-in account is read (the caller checks); a visitor's menu holds nothing to choose.
 */
export async function refreshPerplexityModels(workerWin: BrowserWindow, reload = false): Promise<void> {
  const wc = workerWin.webContents;
  // A separate sign-in window updates shared cookies, but not the worker's loaded document.
  if (reload || !isProviderHost(wc.getURL(), 'perplexity') || wc.isLoading()) {
    applyWorkerUserAgent(wc, WORKER_USER_AGENTS.perplexity);
    await navigateAndWait(wc, PROVIDER_URLS.perplexity);
  }
  await waitForPicker(wc, 15_000);
  await syncPerplexityModel(wc);
}

/**
 * A pick made in the menu reaches the page right away when the worker is already sitting on
 * Perplexity; anywhere else it waits for the next Perplexity send, which syncs first anyway.
 */
export async function syncPerplexityModelIfParked(workerWin: BrowserWindow | null): Promise<void> {
  if (!workerWin || workerWin.isDestroyed()) return;
  const wc = workerWin.webContents;
  if (wc.isLoading() || !isProviderHost(wc.getURL(), 'perplexity')) return;
  await syncPerplexityModel(wc);
}
