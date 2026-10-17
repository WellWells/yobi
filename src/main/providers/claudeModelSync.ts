import type { BrowserWindow, WebContents } from 'electron';
import { config, normalizeClaudeModelChoice, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { WORKER_USER_AGENTS } from '../userAgent';
import { applyWorkerUserAgent } from '../clientHints';
import { isProviderHost, navigateAndWait, sleep } from './common';
import { countElements, executeWithTimeout } from './automationExecutor';
import { isClaudeSignedOutPath } from './claudeSession';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import { needsModelCatalogRestamp } from '../../shared/modelCatalogFreshness';
import {
  EMPTY_CLAUDE_CHOICE,
  claudeModelsMissedByMenu,
  mergeClaudeCatalog,
  upgradeClaudeChoice,
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
  return executeWithTimeout<ClaudePickerResult>(wc, buildClaudeModelPickerScript(target), PICKER_TIMEOUT_MS);
}

function remember(snapshot: ClaudePickerSnapshot, choice: ClaudeModelChoice): void {
  const previous = config.claudeModelCatalog;
  const catalog = mergeClaudeCatalog(previous, snapshot, new Date().toISOString());
  const catalogChanged = !sameClaudeCatalogContent(previous, catalog);
  const choiceChanged = !sameClaudeChoice(config.claudeModel, choice);
  // The merge hands back the very same object when nothing could be read; only a real read
  // counts as "checked", or a broken picker would look freshly read forever.
  const restamp = catalog !== previous && needsModelCatalogRestamp(previous);
  if (!catalogChanged && !choiceChanged && !restamp) return;
  const ids = (list: typeof catalog): string => (list?.models.map((m) => m.id) ?? []).sort().join();
  const listChanged = ids(catalog) !== ids(config.claudeModelCatalog);
  config.claudeModelCatalog = catalog;
  config.claudeModel = choice;
  saveConfig({ claudeModelCatalog: catalog, claudeModel: choice });
  if (listChanged) sendLog(`🧠 Claude models on this account: ${catalog?.models.map((m) => m.label).join(' / ')}`);
  publish();
}

/**
 * A page change rarely fails outright: the menu still opens and simply shows fewer models. Say so
 * in the log, so a stale list is noticed rather than trusted.
 */
function reportReadHealth(snapshot: ClaudePickerSnapshot): void {
  if (snapshot.models.length === 0) {
    sendLog(snapshot.official
      ? '⚠️ Claude\'s model menu listed no models — claude.ai may have changed it; following claude.ai\'s account data for the names'
      : '⚠️ Claude\'s model menu listed no models — claude.ai may have changed it; keeping the cached list');
    return;
  }
  const missed = claudeModelsMissedByMenu(snapshot);
  if (missed.length > 0) sendLog(`⚠️ Claude's model menu did not show ${missed.join(', ')} — claude.ai may have changed it`);
}

/** Moves the setting to the current version when the chosen one has become an older version. */
function followNewerVersion(choice: ClaudeModelChoice, snapshot: ClaudePickerSnapshot): ClaudeModelChoice {
  const previous = config.claudeModelCatalog;
  const next = mergeClaudeCatalog(previous, snapshot, new Date().toISOString());
  const upgrade = upgradeClaudeChoice(choice, previous, next);
  if (!upgrade) return choice;
  const label = (id: string): string => next?.models.find((m) => m.id === id)?.label ?? previous?.models.find((m) => m.id === id)?.label ?? id;
  sendLog(`🧠 Claude ${label(upgrade.from)} has a newer version — switching to ${label(upgrade.choice.modelId)}`);
  return upgrade.choice;
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
    reportReadHealth(read.snapshot);
    const wanted = followNewerVersion(config.claudeModel, read.snapshot);
    // No rows means the menu could not be read, not that the account lost every model: nothing is
    // switched, and the setting (effort included) stays as it was.
    if (read.snapshot.models.length === 0) {
      remember(read.snapshot, wanted);
      return;
    }
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
  if (!isProviderHost(wc.getURL(), 'claude') || wc.isLoading()) {
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
  if (wc.isLoading() || !isProviderHost(wc.getURL(), 'claude') || isClaudeSignedOutPath(wc.getURL())) return;
  await syncClaudeModel(wc);
}
