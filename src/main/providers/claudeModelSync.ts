import type { BrowserWindow, WebContents } from 'electron';
import { config, normalizeClaudeModelChoice, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { navigateAndWait, sleep } from './common';
import { countElements } from './automationExecutor';
import { isClaudeSignedOutPath } from './claudeSession';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import {
  EMPTY_CLAUDE_CHOICE,
  mergeClaudeCatalog,
  reconcileClaudeChoice,
  resolveClaudeTarget,
  sameClaudeCatalogContent,
  sameClaudeChoice,
} from '../../shared/claudeModels';
import type {
  ClaudeModelChoice,
  ClaudeModelState,
  ClaudePickerSnapshot,
  ClaudePickerTarget,
} from '../../shared/claudeModels';
import { CLAUDE_MODEL_TRIGGER_SELECTOR, buildClaudeModelPickerScript } from './claudeModelScript';
import type { ClaudePickerResult } from './claudeModelScript';

/** Reading both submenus and switching three things stays well under two seconds; this stops a hang. */
const PICKER_TIMEOUT_MS = 20_000;

export function getClaudeModelState(): ClaudeModelState {
  return { catalog: config.claudeModelCatalog, choice: config.claudeModel };
}

function publish(): void {
  sendToRenderer(IPC.CLAUDE_MODEL_CHANGED, getClaudeModelState());
}

/**
 * Effort and thinking belong to one model and the page remembers them per model, so choosing a
 * different model hands both back to the page unless the same patch sets them too.
 */
export function setClaudeModelChoice(patch: Partial<ClaudeModelChoice>): ClaudeModelState {
  const current = config.claudeModel;
  const switchingModel = patch.modelId !== undefined && patch.modelId !== current.modelId;
  const base = switchingModel ? { ...current, effort: '', thinking: null } : current;
  const next = normalizeClaudeModelChoice({ ...base, ...patch });
  if (!sameClaudeChoice(next, current)) {
    config.claudeModel = next;
    saveConfig({ claudeModel: next });
    publish();
  }
  return getClaudeModelState();
}

/** Signed out, or a different account: what was cached belongs to someone else's plan. */
export function clearClaudeModels(): void {
  if (!config.claudeModelCatalog && sameClaudeChoice(config.claudeModel, EMPTY_CLAUDE_CHOICE)) return;
  config.claudeModel = EMPTY_CLAUDE_CHOICE;
  config.claudeModelCatalog = null;
  saveConfig({ claudeModel: EMPTY_CLAUDE_CHOICE, claudeModelCatalog: null });
  publish();
}

async function runPicker(wc: WebContents, target: ClaudePickerTarget | null): Promise<ClaudePickerResult> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${PICKER_TIMEOUT_MS} ms`)), PICKER_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([
      wc.executeJavaScript(buildClaudeModelPickerScript(target), true),
      timeout,
    ])) as ClaudePickerResult;
  } finally {
    clearTimeout(timer);
  }
}

function remember(snapshot: ClaudePickerSnapshot, choice: ClaudeModelChoice): void {
  const catalog = mergeClaudeCatalog(config.claudeModelCatalog, snapshot, new Date().toISOString());
  const catalogChanged = !sameClaudeCatalogContent(config.claudeModelCatalog, catalog);
  const choiceChanged = !sameClaudeChoice(config.claudeModel, choice);
  if (!catalogChanged && !choiceChanged) return;
  const ids = (list: typeof catalog): string => (list?.models.map((m) => m.id) ?? []).sort().join();
  const listChanged = ids(catalog) !== ids(config.claudeModelCatalog);
  config.claudeModelCatalog = catalog;
  config.claudeModel = choice;
  saveConfig({ claudeModelCatalog: catalog, claudeModel: choice });
  if (listChanged) sendLog(`🧠 Claude models on this account: ${catalog?.models.map((m) => m.label).join(' / ')}`);
  publish();
}

function describe(snapshot: ClaudePickerSnapshot): string {
  const model = snapshot.models.find((m) => m.selected)?.label ?? '?';
  const effort = snapshot.options?.efforts.find((e) => e.selected)?.label;
  const thinking = snapshot.options?.thinking;
  return [model, effort, thinking ? `${thinking.label} ${thinking.selected ? 'on' : 'off'}` : '']
    .filter(Boolean)
    .join(' · ');
}

function needsApplying(target: ClaudePickerTarget, snapshot: ClaudePickerSnapshot): boolean {
  if (target.modelId !== null) return true;
  const options = snapshot.options;
  if (!options) return false;
  const effortDiffers = target.effort !== null
    && options.efforts.some((e) => e.id === target.effort)
    && !options.efforts.some((e) => e.id === target.effort && e.selected);
  const thinkingDiffers = target.thinking !== null && options.thinking !== null && options.thinking.selected !== target.thinking;
  return effortDiffers || thinkingDiffers;
}

/**
 * Makes claude.ai's picker match Yobi's Claude setting, refreshing the cached model list on the
 * way. Never throws: a picker that moved or cannot be read must not cost the user their answer.
 */
export async function syncClaudeModel(wc: WebContents): Promise<void> {
  try {
    const read = await runPicker(wc, null);
    if (!read.ok) {
      sendLog(`⚠️ Claude model picker unavailable (${read.reason}) — sending with the page's current model`);
      return;
    }
    const wanted = config.claudeModel;
    const decision = resolveClaudeTarget(wanted, read.snapshot);
    if (decision.unavailable) {
      const now = read.snapshot.models.find((m) => m.id === decision.modelId)?.label ?? decision.modelId;
      sendLog(`🧠 Claude model ${decision.unavailable} is not available on this account — using ${now}`);
    }

    let snapshot = read.snapshot;
    if (needsApplying(decision.target, snapshot)) {
      const applied = await runPicker(wc, decision.target);
      if (!applied.ok) {
        sendLog(`⚠️ Could not switch the Claude model (${applied.reason}) — sending with ${describe(snapshot)}`);
        remember(snapshot, reconcileClaudeChoice(decision.modelId, wanted, snapshot));
        return;
      }
      snapshot = applied.snapshot;
      const live = snapshot.models.find((m) => m.selected)?.id;
      if (decision.modelId && live !== decision.modelId) {
        sendLog(`⚠️ Claude did not take the switch — sending with ${describe(snapshot)}`);
        remember(snapshot, wanted);
        return;
      }
      sendLog(`🧠 Claude switched to ${describe(snapshot)}`);
    }
    const kept = decision.unavailable ? { modelId: decision.modelId, effort: '', thinking: null } : wanted;
    remember(snapshot, reconcileClaudeChoice(decision.modelId, kept, snapshot));
  } catch (err) {
    sendLog(`⚠️ Claude model sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function isClaudePage(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(PROVIDER_URLS.claude).hostname;
  } catch {
    return false;
  }
}

async function waitForPicker(wc: WebContents, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && (await countElements(wc, CLAUDE_MODEL_TRIGGER_SELECTOR)) === 0) {
    if (isClaudeSignedOutPath(wc.getURL())) return;
    await sleep(200);
  }
}

/**
 * Loads Claude just far enough to read its picker: a first run with nothing cached, or right after
 * signing in (the account, and so the list, may have changed). Signed out it reads nothing.
 */
export async function refreshClaudeModels(workerWin: BrowserWindow): Promise<void> {
  const wc = workerWin.webContents;
  if (!isClaudePage(wc.getURL()) || wc.isLoading()) {
    applyWorkerUserAgent(wc, WORKER_USER_AGENTS.claude);
    await navigateAndWait(wc, PROVIDER_URLS.claude);
  }
  await waitForPicker(wc, 15_000);
  if (isClaudeSignedOutPath(wc.getURL())) return;
  await syncClaudeModel(wc);
}

/** A pick made in the menu reaches the page at once when the worker already sits on Claude. */
export async function syncClaudeModelIfParked(workerWin: BrowserWindow | null): Promise<void> {
  if (!workerWin || workerWin.isDestroyed()) return;
  const wc = workerWin.webContents;
  if (wc.isLoading() || !isClaudePage(wc.getURL()) || isClaudeSignedOutPath(wc.getURL())) return;
  await syncClaudeModel(wc);
}
