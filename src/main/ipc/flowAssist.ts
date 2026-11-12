import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import {
  parseAssistEditRequest, parseAssistExplainRequest, parseAssistNamesRequest,
} from '../../shared/flowAssist';
import type {
  FlowAssistEditResult, FlowAssistExplainResult, FlowAssistNamesResult,
} from '../../shared/flowAssist';
import { withClarifications } from '../../shared/flowSkillSchema';
import { config, saveConfig } from '../config';
import { oneShotIo } from '../chat/oneShotRequest';
import { explainFlow, nameFlowSteps } from '../flowAssist';
import { parseFlowTooLongToRevise } from '../flow/flowBuildTooLong';
import type { FlowManager } from '../flow/flowManager';
import { sendLog } from '../helpers';
import { getLangCache, localizeUserFacingError, t } from '../i18n';

/*
 * The flow editor's AI assistant. Every request carries the editor's draft and answers with a
 * proposal; nothing here saves a flow. The model is the one AI flow building uses
 * (`config.flowGenerateUrl`), remembered on every pick the way that one is.
 */

export interface FlowAssistDeps {
  flowManager: () => FlowManager | null;
}

/** Each request by the id the window gave it, so a cancel finds it. */
const running = new Map<string, AbortController>();

function rememberModel(providerUrl: string): void {
  if (!providerUrl || providerUrl === config.flowGenerateUrl) return;
  config.flowGenerateUrl = providerUrl;
  saveConfig({ flowGenerateUrl: providerUrl });
}

function failed(error: string): { ok: false; reason: 'failed'; error: string } {
  return { ok: false, reason: 'failed', error };
}

async function track<T>(id: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  running.get(id)?.abort();
  const controller = new AbortController();
  running.set(id, controller);
  try {
    return await work(controller.signal);
  } finally {
    if (running.get(id) === controller) running.delete(id);
  }
}

export async function handleAssistEdit(raw: unknown, deps: FlowAssistDeps): Promise<FlowAssistEditResult> {
  const strings = getLangCache();
  const request = parseAssistEditRequest(raw);
  const manager = deps.flowManager();
  if (!request || !manager) return failed(t(strings, 'flow.assist.error.invalid'));
  rememberModel(request.providerUrl);
  const change = withClarifications(request.change, request.answers ?? []);
  sendLog(`🧩 [Flow assist] changing the draft of "${request.flow.name}"`);
  return track(request.id, async (signal) => {
    const outcome = await manager.queueEditProposal(request.id, request.flow, change, {
      queueLabel: t(strings, 'flow.assist.queueLabel'),
      ...(request.providerUrl ? { providerUrl: request.providerUrl } : {}),
    });
    // A running edit cannot be stopped part-way; a cancelled one's answer is dropped.
    if (signal.aborted) return { ok: false, reason: 'cancelled' };
    switch (outcome.status) {
      case 'saved':
        return { ok: true, status: 'proposal', flow: outcome.flow, issues: outcome.issues, paused: outcome.paused };
      case 'questions':
        return { ok: true, status: 'questions', questions: outcome.questions };
      case 'unchanged':
        return { ok: true, status: 'unchanged' };
      case 'declined':
        return { ok: false, reason: 'cancelled' };
      case 'failed': {
        sendLog(`⚠️ [Flow assist] no change: ${outcome.error}`);
        // "Change it in the flow editor" is no help to someone who is in it.
        if (parseFlowTooLongToRevise(outcome.error) !== null) return failed(t(strings, 'flow.assist.error.tooLong'));
        return failed(localizeUserFacingError(outcome.error, strings));
      }
    }
  });
}

export async function handleAssistExplain(raw: unknown): Promise<FlowAssistExplainResult> {
  const strings = getLangCache();
  const request = parseAssistExplainRequest(raw);
  if (!request || !request.providerUrl) return failed(t(strings, 'flow.assist.error.invalid'));
  rememberModel(request.providerUrl);
  sendLog(`🧩 [Flow assist] explaining "${request.flow.name}"`);
  return track(request.id, async (signal) => {
    const result = await explainFlow(request, oneShotIo(signal, () => undefined), {
      locale: config.locale,
      emptyReply: t(strings, 'flow.assist.error.empty'),
      tooLong: t(strings, 'flow.assist.error.tooLong'),
      headings: {
        when: t(strings, 'flow.assist.explain.when'),
        steps: t(strings, 'flow.assist.explain.steps'),
        results: t(strings, 'flow.assist.explain.results'),
        problems: t(strings, 'flow.assist.explain.problems'),
      },
    });
    if (result.ok) return { ok: true, markdown: result.value };
    if (result.reason === 'cancelled') return result;
    sendLog(`⚠️ [Flow assist] no explanation: ${result.error}`);
    return failed(localizeUserFacingError(result.error, strings));
  });
}

export async function handleAssistNames(raw: unknown): Promise<FlowAssistNamesResult> {
  const strings = getLangCache();
  const request = parseAssistNamesRequest(raw);
  if (!request || !request.providerUrl) return failed(t(strings, 'flow.assist.error.invalid'));
  rememberModel(request.providerUrl);
  sendLog(`🏷️ [Flow assist] naming ${request.targets.length} step(s)`);
  return track(request.id, async (signal) => {
    const result = await nameFlowSteps(request, oneShotIo(signal, () => undefined), {
      locale: config.locale,
      emptyReply: t(strings, 'flow.assist.error.empty'),
      tooLong: t(strings, 'flow.assist.error.tooLong'),
    });
    if (result.ok) return { ok: true, names: result.value };
    if (result.reason === 'cancelled') return result;
    sendLog(`⚠️ [Flow assist] no names: ${result.error}`);
    return failed(localizeUserFacingError(result.error, strings));
  });
}

export function cancelAssist(id: unknown, deps: FlowAssistDeps): boolean {
  if (typeof id !== 'string') return false;
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  deps.flowManager()?.cancelQueuedTask(id);
  return true;
}

export function registerFlowAssistHandlers(deps: FlowAssistDeps): void {
  ipcMain.handle(IPC.FLOW_ASSIST_EDIT, (_event, request: unknown) => handleAssistEdit(request, deps));
  ipcMain.handle(IPC.FLOW_ASSIST_EXPLAIN, (_event, request: unknown) => handleAssistExplain(request));
  ipcMain.handle(IPC.FLOW_ASSIST_NAMES, (_event, request: unknown) => handleAssistNames(request));
  ipcMain.handle(IPC.FLOW_ASSIST_CANCEL, (_event, id: unknown) => cancelAssist(id, deps));
}
