import type { BrowserWindow, WebContents } from 'electron';
import { config, normalizeChatgptModelChoice, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { navigateAndWait, sleep } from './common';
import { countElements } from './automationExecutor';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import {
  EMPTY_CHATGPT_CHOICE,
  chatgptCatalogFromSnapshot,
  reconcileChatgptChoice,
  resolveChatgptTarget,
  sameChatgptCatalogContent,
  sameChatgptChoice,
} from '../../shared/chatgptModels';
import type {
  ChatgptModelChoice,
  ChatgptModelState,
  ChatgptPickerSnapshot,
  ChatgptPickerTarget,
} from '../../shared/chatgptModels';
import { CHATGPT_PICKER_PILL_SELECTOR, buildChatgptModelPickerScript } from './chatgptModelScript';
import type { ChatgptPickerResult } from './chatgptModelScript';

/** A read plus a switch stays around a second; this only stops a hang. */
const PICKER_TIMEOUT_MS = 20_000;

export function getChatgptModelState(): ChatgptModelState {
  return { catalog: config.chatgptModelCatalog, choice: config.chatgptModel };
}

function publish(): void {
  sendToRenderer(IPC.CHATGPT_MODEL_CHANGED, getChatgptModelState());
}

/** Every version offers the same kind of steps and the page keeps the step across a switch, so a model change keeps the effort. */
export function setChatgptModelChoice(patch: Partial<ChatgptModelChoice>): ChatgptModelState {
  const current = config.chatgptModel;
  const next = normalizeChatgptModelChoice({ ...current, ...patch });
  if (!sameChatgptChoice(next, current)) {
    config.chatgptModel = next;
    saveConfig({ chatgptModel: next });
    publish();
  }
  return getChatgptModelState();
}

/** Signed out, or a different account: what was cached belongs to someone else's plan. */
export function clearChatgptModels(): void {
  if (!config.chatgptModelCatalog && sameChatgptChoice(config.chatgptModel, EMPTY_CHATGPT_CHOICE)) return;
  config.chatgptModel = EMPTY_CHATGPT_CHOICE;
  config.chatgptModelCatalog = null;
  saveConfig({ chatgptModel: EMPTY_CHATGPT_CHOICE, chatgptModelCatalog: null });
  publish();
}

async function runPicker(wc: WebContents, target: ChatgptPickerTarget | null): Promise<ChatgptPickerResult> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${PICKER_TIMEOUT_MS} ms`)), PICKER_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([
      wc.executeJavaScript(buildChatgptModelPickerScript(target), true),
      timeout,
    ])) as ChatgptPickerResult;
  } finally {
    clearTimeout(timer);
  }
}

function remember(snapshot: ChatgptPickerSnapshot, choice: ChatgptModelChoice): void {
  const catalog = chatgptCatalogFromSnapshot(config.chatgptModelCatalog, snapshot, new Date().toISOString());
  const catalogChanged = !sameChatgptCatalogContent(config.chatgptModelCatalog, catalog);
  const choiceChanged = !sameChatgptChoice(config.chatgptModel, choice);
  if (!catalogChanged && !choiceChanged) return;
  const ids = (list: typeof catalog): string => (list?.models.map((m) => m.id) ?? []).join();
  const listChanged = ids(catalog) !== ids(config.chatgptModelCatalog);
  config.chatgptModelCatalog = catalog;
  config.chatgptModel = choice;
  saveConfig({ chatgptModelCatalog: catalog, chatgptModel: choice });
  if (listChanged && catalog?.models.length) {
    sendLog(`🧠 ChatGPT models on this account: ${catalog.models.map((m) => m.label).join(' / ')}`);
  }
  publish();
}

function describe(snapshot: ChatgptPickerSnapshot): string {
  const model = snapshot.models.find((m) => m.selected);
  const effort = model?.efforts.find((e) => e.selected)?.label;
  const thinking = snapshot.thinking;
  return [model?.label, effort, thinking ? `${thinking.label} ${thinking.selected ? 'on' : 'off'}` : '']
    .filter(Boolean)
    .join(' · ') || '?';
}

function liveEffort(snapshot: ChatgptPickerSnapshot): string | null {
  return snapshot.models.find((m) => m.selected)?.efforts.find((e) => e.selected)?.id ?? null;
}

function needsApplying(target: ChatgptPickerTarget, snapshot: ChatgptPickerSnapshot): boolean {
  if (target.modelId !== null) return true;
  const effortDiffers = target.effort !== null && liveEffort(snapshot) !== target.effort;
  const thinkingDiffers = target.thinking !== null && snapshot.thinking !== null && snapshot.thinking.selected !== target.thinking;
  return effortDiffers || thinkingDiffers;
}

function tookEffect(target: ChatgptPickerTarget, modelId: string, snapshot: ChatgptPickerSnapshot): boolean {
  const live = snapshot.models.find((m) => m.selected)?.id;
  if (modelId && snapshot.models.length > 0 && live !== modelId) return false;
  if (target.effort !== null && liveEffort(snapshot) !== target.effort) return false;
  return target.thinking === null || snapshot.thinking === null || snapshot.thinking.selected === target.thinking;
}

/**
 * Makes chatgpt.com's controls match Yobi's ChatGPT setting, refreshing the cached list on the way.
 * Never throws: controls that moved or cannot be read must not cost the user their answer.
 */
export async function syncChatgptModel(wc: WebContents): Promise<void> {
  try {
    const read = await runPicker(wc, null);
    if (!read.ok) {
      sendLog(`⚠️ ChatGPT model picker unavailable (${read.reason}) — sending with the page's current model`);
      return;
    }
    let snapshot = read.snapshot;
    if (snapshot.models.length === 0 && !snapshot.thinking) {
      sendLog('⚠️ ChatGPT model picker showed nothing to choose — sending with the page\'s current model');
      return;
    }
    const wanted = config.chatgptModel;
    const decision = resolveChatgptTarget(wanted, snapshot);
    if (decision.unavailable) {
      const now = snapshot.models.find((m) => m.id === decision.modelId)?.label ?? decision.modelId;
      sendLog(`🧠 ChatGPT model ${decision.unavailable} is not available on this account — using ${now}`);
    }

    if (needsApplying(decision.target, snapshot)) {
      const applied = await runPicker(wc, decision.target);
      if (!applied.ok) {
        sendLog(`⚠️ Could not switch the ChatGPT model (${applied.reason}) — sending with ${describe(snapshot)}`);
        remember(snapshot, reconcileChatgptChoice(decision.modelId, wanted, snapshot));
        return;
      }
      snapshot = applied.snapshot;
      if (!tookEffect(decision.target, decision.modelId, snapshot)) {
        sendLog(`⚠️ ChatGPT did not take the switch — sending with ${describe(snapshot)}`);
        remember(snapshot, reconcileChatgptChoice(decision.modelId, wanted, snapshot));
        return;
      }
      sendLog(`🧠 ChatGPT switched to ${describe(snapshot)}`);
    }
    remember(snapshot, reconcileChatgptChoice(decision.modelId, wanted, snapshot));
  } catch (err) {
    sendLog(`⚠️ ChatGPT model sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function isChatgptPage(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(PROVIDER_URLS.chatgpt).hostname;
  } catch {
    return false;
  }
}

async function waitForPicker(wc: WebContents, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (await countElements(wc, CHATGPT_PICKER_PILL_SELECTOR)) === 0) {
    if (!isChatgptPage(wc.getURL())) return;
    await sleep(200);
  }
}

/**
 * Loads ChatGPT just far enough to read its controls: a first run with nothing cached, or right
 * after signing in (the account, and so the plan, may have changed).
 */
export async function refreshChatgptModels(workerWin: BrowserWindow): Promise<void> {
  const wc = workerWin.webContents;
  if (!isChatgptPage(wc.getURL()) || wc.isLoading()) {
    applyWorkerUserAgent(wc, WORKER_USER_AGENTS.chatgpt);
    await navigateAndWait(wc, PROVIDER_URLS.chatgpt);
  }
  await waitForPicker(wc, 15_000);
  if (!isChatgptPage(wc.getURL())) return;
  await syncChatgptModel(wc);
}

/** A pick made in the menu reaches the page at once when the worker already sits on ChatGPT. */
export async function syncChatgptModelIfParked(workerWin: BrowserWindow | null): Promise<void> {
  if (!workerWin || workerWin.isDestroyed()) return;
  const wc = workerWin.webContents;
  if (wc.isLoading() || !isChatgptPage(wc.getURL())) return;
  await syncChatgptModel(wc);
}
