import { app, ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { IPC } from '../../shared/types';
import type { ChatTurnEvent, ShellInfo, ShellOutputEvent, ShellRunReply, ShellRunRequest, Task } from '../../shared/types';
import type { TurnShell } from '../../shared/conversationDoc';
import { lastShellFolder, shellTurnPrompt } from '../../shared/shellBang';
import { fillTemplate } from '../../shared/fillTemplate';
import { config } from '../config';
import { createTaskId, getMainWindow, normalizeAiUrl, sendLog, sendToRenderer } from '../helpers';
import { loadLanguageData, t } from '../i18n';
import { listOutputFiles } from '../files';
import { discardEmptyConversation, titleFromPrompt } from '../output';
import { getProviderLabel } from '../providers';
import { conversationPathKey } from '../conversationPaths';
import { whileConversationBusy } from '../conversationBusy';
import { getTempChatConversation, isTempChatMode } from '../tempChat';
import { loadConversation } from '../chat/conversationStore';
import { promptCapFor } from '../chat/conversationContext';
import { buildShellResultPrompt, shellOutputBudget, shellRecordOutput } from '../chat/shellPrompt';
import { keepUnansweredShellTurn } from '../chat/shellTurns';
import { SHELL_COMMAND_MAX, shellTextDenyReason } from '../flow/agent/shellApproval';
import { resolveDefaultShell, type ResolvedShell } from '../shell/defaultShell';
import { runShellCommand, ShellStartError, stopAllShellRuns } from '../shell/shellRun';
import type { IpcContext } from './context';

/*
 * A chat line starting with `!`: the command runs in the user's default shell, in the folder the
 * conversation's last command left it in, its output shows as it comes, and the model is then
 * asked to read it as an ordinary chat turn. Only the desktop window sends these; no bot can.
 */

const TEMPORARY_KEY = '\u0000temporary';

/** Where each conversation's last command left the shell, until the app quits; the file has it after that. */
const folders = new Map<string, string>();
const running = new Map<string, AbortController>();

function folderKey(conversationPath: string | undefined): string {
  return conversationPath ? conversationPathKey(conversationPath) : TEMPORARY_KEY;
}

async function isFolder(candidate: string): Promise<boolean> {
  return fs.stat(candidate).then((stat) => stat.isDirectory(), () => false);
}

async function rememberedFolder(conversationPath: string | undefined): Promise<string | null> {
  if (conversationPath) {
    const known = folders.get(folderKey(conversationPath));
    if (known) return known;
    const loaded = await loadConversation(conversationPath).catch(() => null);
    return loaded ? lastShellFolder(loaded.doc.turns) : null;
  }
  // A temporary chat that was cleared (or never started) begins again at home.
  const doc = isTempChatMode() ? await getTempChatConversation() : null;
  if (!doc) {
    folders.delete(TEMPORARY_KEY);
    return null;
  }
  return folders.get(TEMPORARY_KEY) ?? lastShellFolder(doc.turns);
}

/** The folder a command in this conversation starts in: where the last one left off, else the home folder. */
export async function shellFolderFor(conversationPath: string | undefined): Promise<string> {
  const remembered = await rememberedFolder(conversationPath);
  return remembered && await isFolder(remembered) ? remembered : os.homedir();
}

function shellTurnMeta(shell: ResolvedShell, folder: string, cwdAfter: string, exitCode: number | null, stopped: boolean): TurnShell {
  return {
    s: shell.label,
    w: folder,
    ...(cwdAfter !== folder ? { to: cwdAfter } : {}),
    ...(exitCode !== null && !stopped ? { x: exitCode } : {}),
    ...(stopped ? { k: 1 as const } : {}),
  };
}

/** Nothing ran: the file the chat made for this first message goes again, as a failed send's does. */
async function refuse(conversationPath: string | undefined, error: string): Promise<ShellRunReply> {
  if (conversationPath && await discardEmptyConversation(conversationPath)) {
    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
  }
  return { ok: false, error };
}

export function registerShellHandlers(ctx: IpcContext): void {
  app.on('will-quit', stopAllShellRuns);

  ipcMain.handle(IPC.CHAT_SHELL_INFO, async (_event, conversationPath?: string): Promise<ShellInfo> => {
    const [shell, folder] = await Promise.all([resolveDefaultShell(), shellFolderFor(conversationPath || undefined)]);
    return { shell: shell.label, folder };
  });

  ipcMain.handle(IPC.CHAT_SHELL_STOP, (_event, sendId: string): boolean => {
    const controller = running.get(String(sendId ?? ''));
    if (!controller) return false;
    controller.abort();
    return true;
  });

  ipcMain.handle(IPC.CHAT_SHELL_RUN, async (event, request: ShellRunRequest): Promise<ShellRunReply> => {
    // Only the chat window runs commands: no other window's page may reach this, whatever it loads.
    if (event.sender !== getMainWindow()?.webContents) return { ok: false, error: '' };
    const strings = (await loadLanguageData(config.locale)) ?? {};
    const command = String(request?.command ?? '').trim();
    const sendId = String(request?.sendId ?? '').trim();
    const conversationPath = String(request?.conversationPath ?? '').trim() || undefined;
    const refusal = !command || !sendId || running.has(sendId)
      ? t(strings, 'chat.shell.error.empty')
      : command.length > SHELL_COMMAND_MAX
        ? t(strings, 'chat.shell.error.tooLong', { max: String(SHELL_COMMAND_MAX) })
        // What is on screen has to be what runs: a pasted line can hide text-direction controls.
        : shellTextDenyReason({ command }, process.platform)
          ? t(strings, 'chat.shell.error.hidden')
          : null;
    if (refusal) return refuse(conversationPath, refusal);

    const targetUrl = request.targetUrl?.trim() ? normalizeAiUrl(request.targetUrl) : config.targetUrl;
    // Sampled once, as `processTask` does: a temporary chat's commands share one folder.
    const temporary = isTempChatMode();
    const folderOwner = temporary ? undefined : conversationPath;
    const controller = new AbortController();
    running.set(sendId, controller);

    return whileConversationBusy(conversationPath, 'sending', async (): Promise<ShellRunReply> => {
      try {
        const shell = await resolveDefaultShell();
        const folder = await shellFolderFor(folderOwner);
        const report = (event: Omit<ShellOutputEvent, 'sendId' | 'shell' | 'folder'>): void => {
          sendToRenderer(IPC.CHAT_SHELL_OUTPUT, { sendId, shell: shell.label, folder, ...event } satisfies ShellOutputEvent);
        };
        report({ text: '', done: false });
        sendLog(`[Shell] ▶ ${shell.label} in ${folder}: ${command.split('\n')[0]}`);

        const result = await runShellCommand({
          shell,
          command,
          cwd: folder,
          signal: controller.signal,
          onProgress: (latest) => report({ text: latest, done: false }),
        });
        folders.set(folderKey(folderOwner), result.cwdAfter);
        sendLog(`[Shell] ${result.stopped ? '⏹ stopped' : `■ exit ${result.exitCode ?? '?'}`}${result.cwdAfter !== folder ? ` → ${result.cwdAfter}` : ''}`);

        const recordOutput = shellRecordOutput(
          result.output,
          (lines) => fillTemplate(t(strings, 'chat.shell.omitted'), { count: String(lines) }),
        );
        const record = shellTurnPrompt(command, recordOutput);
        const meta = shellTurnMeta(shell, folder, result.cwdAfter, result.exitCode, result.stopped);
        report({ text: recordOutput, done: true, exitCode: result.exitCode, stopped: result.stopped });

        const prompt = buildShellResultPrompt({
          shellLabel: shell.label,
          folder,
          command,
          output: result.output,
          exitCode: result.exitCode,
          stopped: result.stopped,
          outputBudget: shellOutputBudget(promptCapFor(targetUrl)),
        });

        // Stopped: the user wanted it to end there, so no answer is asked for. The masked copy is
        // what a later question replays, never the raw output the record shows.
        if (result.stopped) {
          const kept = await keepUnansweredShellTurn({ prompt: record, sent: prompt, shell: meta, conversationPath, temporary });
          if (kept) sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
          sendToRenderer(IPC.CHAT_TURN, {
            sendId,
            conversationPath: kept ?? '',
            phase: 'done',
            prompt: record,
            response: '',
          } satisfies ChatTurnEvent);
          return { ok: true };
        }

        const task: Task = {
          id: createTaskId(),
          prompt,
          displayPrompt: record,
          targetUrl,
          source: 'ui',
          conversationPath,
          placeholderTitle: titleFromPrompt(`! ${command}`),
          sendId,
          external: true,
          shell: meta,
        };
        ctx.queue.enqueue(task);
        sendLog(`[${task.id}] 🎯 Command output queued for ${getProviderLabel(targetUrl)}`);
        return { ok: true };
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        sendLog(`❌ [Shell] ${reason}`);
        const error = err instanceof ShellStartError
          ? t(strings, 'chat.shell.error.start', { shell: err.shell.label })
          : t(strings, 'chat.shell.error.failed');
        return refuse(conversationPath, error);
      } finally {
        running.delete(sendId);
      }
    });
  });
}
