import type { BrowserWindow, WebContents } from 'electron';
import { config, normalizeGeminiModelChoice, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { navigateAndWait, sleep } from './common';
import { countElements } from './automationExecutor';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import {
  resolveGeminiTarget,
  sameCatalogContent,
  sameGeminiChoice,
  snapshotToCatalog,
} from '../../shared/geminiModels';
import type {
  GeminiModelChoice,
  GeminiModelState,
  GeminiPickerSnapshot,
  GeminiPickerTarget,
} from '../../shared/geminiModels';
import { GEMINI_MODE_BUTTON_SELECTOR, buildGeminiModelPickerScript } from './geminiModelScript';
import type { GeminiPickerResult } from './geminiModelScript';

/** Opening, switching twice and re-reading takes well under two seconds; this only stops a hang. */
const PICKER_TIMEOUT_MS = 15_000;

export function getGeminiModelState(): GeminiModelState {
  return { catalog: config.geminiModelCatalog, choice: config.geminiModel };
}

function publish(): void {
  sendToRenderer(IPC.GEMINI_MODEL_CHANGED, getGeminiModelState());
}

export function setGeminiModelChoice(patch: Partial<GeminiModelChoice>): GeminiModelState {
  const next = normalizeGeminiModelChoice({ ...config.geminiModel, ...patch });
  if (!sameGeminiChoice(next, config.geminiModel)) {
    config.geminiModel = next;
    saveConfig({ geminiModel: next });
    publish();
  }
  return getGeminiModelState();
}

async function runPicker(wc: WebContents, target: GeminiPickerTarget | null): Promise<GeminiPickerResult> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${PICKER_TIMEOUT_MS} ms`)), PICKER_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([
      wc.executeJavaScript(buildGeminiModelPickerScript(target), true),
      timeout,
    ])) as GeminiPickerResult;
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps the catalog and the setting in step with what the page just showed. */
function remember(snapshot: GeminiPickerSnapshot, choice: GeminiModelChoice): void {
  // An empty read keeps the last good list: a menu that briefly renders nothing is not news.
  const catalog = snapshot.models.length > 0
    ? snapshotToCatalog(snapshot, new Date().toISOString())
    : config.geminiModelCatalog;
  const catalogChanged = !sameCatalogContent(config.geminiModelCatalog, catalog);
  const choiceChanged = !sameGeminiChoice(config.geminiModel, choice);
  if (!catalogChanged && !choiceChanged) return;
  config.geminiModelCatalog = catalog;
  config.geminiModel = choice;
  saveConfig({ geminiModelCatalog: catalog, geminiModel: choice });
  if (catalogChanged) sendLog(`🧠 Gemini model list updated: ${catalog?.models.map((m) => m.label).join(' / ')}`);
  publish();
}

function describe(snapshot: GeminiPickerSnapshot): string {
  const model = snapshot.models.find((m) => m.selected)?.label ?? '?';
  if (!snapshot.thinking) return model;
  return `${model}, ${snapshot.thinking.label} ${snapshot.thinking.selected ? 'on' : 'off'}`;
}

function matches(snapshot: GeminiPickerSnapshot, target: GeminiPickerTarget): boolean {
  const modelOk = target.modelId === null || snapshot.models.some((m) => m.id === target.modelId && m.selected);
  const thinkingOk = target.thinking === null || snapshot.thinking?.selected === target.thinking;
  return modelOk && thinkingOk;
}

/**
 * Makes Gemini's picker match Yobi's Gemini setting, refreshing the cached model list on the way.
 *
 * Never throws: a picker that has moved or cannot be read must not cost the user their answer, so
 * the send goes ahead on whatever the page has selected and the log says so.
 */
export async function syncGeminiModel(wc: WebContents): Promise<void> {
  try {
    const read = await runPicker(wc, null);
    if (!read.ok) {
      sendLog(`⚠️ Gemini model picker unavailable (${read.reason}) — sending with the page's current model`);
      return;
    }
    const decision = resolveGeminiTarget(config.geminiModel, config.geminiModelCatalog, read.snapshot);
    if (decision.remappedFrom) {
      const gone = config.geminiModelCatalog?.models.find((m) => m.id === decision.remappedFrom)?.label ?? decision.remappedFrom;
      const now = read.snapshot.models.find((m) => m.id === decision.choice.modelId)?.label ?? decision.choice.modelId;
      sendLog(`🧠 Gemini no longer offers ${gone} — switching to ${now}, the model in the same place`);
    }

    let snapshot = read.snapshot;
    const { target } = decision;
    if (target.modelId !== null || target.thinking !== null) {
      const applied = await runPicker(wc, target);
      if (!applied.ok) {
        sendLog(`⚠️ Could not switch the Gemini model (${applied.reason}) — sending with ${describe(snapshot)}`);
        remember(snapshot, decision.choice);
        return;
      }
      snapshot = applied.snapshot;
      sendLog(matches(snapshot, target)
        ? `🧠 Gemini switched to ${describe(snapshot)}`
        : `⚠️ Gemini did not take the switch — sending with ${describe(snapshot)}`);
    }
    remember(snapshot, decision.choice);
  } catch (err) {
    sendLog(`⚠️ Gemini model sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function isGeminiPage(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(PROVIDER_URLS.gemini).hostname;
  } catch {
    return false;
  }
}

async function waitForPicker(wc: WebContents, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (await countElements(wc, GEMINI_MODE_BUTTON_SELECTOR)) === 0) {
    await sleep(200);
  }
}

/**
 * For a first run with nothing cached: loads Gemini just far enough to read its picker. Runs once
 * per install, so leaving the worker on Gemini afterwards costs the next other-provider send one
 * reload at most.
 */
export async function refreshGeminiModels(workerWin: BrowserWindow): Promise<void> {
  const wc = workerWin.webContents;
  if (!isGeminiPage(wc.getURL()) || wc.isLoading()) {
    applyWorkerUserAgent(wc, WORKER_USER_AGENTS.gemini);
    await navigateAndWait(wc, PROVIDER_URLS.gemini);
  }
  await waitForPicker(wc, 15_000);
  await syncGeminiModel(wc);
}

/**
 * A pick made in the menu reaches the page right away when the worker is already sitting on
 * Gemini, so the account (and the user's own browser) shows it too. Anywhere else it waits for the
 * next Gemini send, which syncs first anyway — a page load just to flip a setting is not worth it.
 */
export async function syncGeminiModelIfParked(workerWin: BrowserWindow | null): Promise<void> {
  if (!workerWin || workerWin.isDestroyed()) return;
  const wc = workerWin.webContents;
  if (wc.isLoading() || !isGeminiPage(wc.getURL())) return;
  await syncGeminiModel(wc);
}
