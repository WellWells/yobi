import { BUILTIN_QUICKSEARCH_COMMAND, BUILTIN_SEARCH_COMMAND, IPC } from '../../shared/types';
import type { SearchCommandResult, SearchMode } from '../../shared/types';
import { pickConversationTitle } from '../../shared/conversationTitle';
import { config } from '../config';
import { listOutputFiles } from '../files';
import { buildOutputMarkdown } from '../output';
import { saveCommandOutput } from './commandOutput';
import { runUrlShortcut } from './urlShortcut';
import { deliverTempChatResult, isTempChatMode } from '../tempChat';
import { sendLog, sendToRenderer } from '../helpers';
import { localizeUserFacingError, t } from '../i18n';
import { getProviderLabel } from '../providers';
import { runWebSearch, SearchPipelineError } from '../search';
import { measureTokens } from '../tokenMeter';
import { mdLinkDestination } from '../search/synthesize';
import type { SearchProgress, SourceDoc } from '../search';
import type { TokenUsage } from '../../shared/tokenEstimate';
import type { CommandOrigin } from './commandOrigin';
import type { FlowManager } from '../flow';

type Strings = Record<string, string>;

/** Adds the delivered text, which a bot needs in order to send the reply on. */
export interface SearchRunOutcome extends SearchCommandResult {
  answer?: string;
  title?: string;
}

export interface SearchRunRequest {
  query: string;
  strings: Strings;
  targetUrl?: string;
  mode?: SearchMode;
  conversationPath?: string;
  clientToken?: string;
  origin?: CommandOrigin;
  /** Progress for a caller with no queue UI to read — a bot. See AgentRunRequest. */
  onProgressText?: (text: string) => void;
}

function mdLabel(title: string): string {
  return title.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSourcesSection(sources: SourceDoc[], heading: string): string {
  const list = sources
    .map((s) => `${s.id}. [${mdLabel(s.title)}](${mdLinkDestination(s.url)})`)
    .join('\n');
  return `---\n\n**${heading}**\n\n${list}`;
}

function summarizeQuery(query: string): string {
  const compact = query.replace(/\s+/g, ' ').trim();
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact;
}

function progressText(progress: SearchProgress, strings: Strings): string {
  switch (progress.stage) {
    case 'planning':
      return t(strings, 'search.progress.planning');
    case 'fetching':
      return t(strings, 'search.progress.fetching', { count: String(progress.count) });
    case 'read':
      return t(strings, 'search.progress.read', { host: progress.host });
    case 'synthesizing':
      return t(strings, 'search.progress.synthesizing');
    default:
      return t(strings, 'search.progress.analyzing');
  }
}

export function runSearchCommand(
  flowManager: FlowManager | undefined,
  request: SearchRunRequest,
): Promise<SearchRunOutcome> {
  const { query, strings, conversationPath } = request;
  const origin = request.origin ?? 'app';
  const searchMode: SearchMode = request.mode === 'quick' ? 'quick' : 'standard';
  const commandName = searchMode === 'quick' ? BUILTIN_QUICKSEARCH_COMMAND : BUILTIN_SEARCH_COMMAND;
  const resolvedTarget = (request.targetUrl ?? '').trim() || config.targetUrl;

  const deliver = async (
    answer: string,
    title: string,
    providerUrl: string,
    usage: TokenUsage,
    sourcesSection?: string,
  ): Promise<SearchRunOutcome> => {
    const response = sourcesSection ? `${answer}\n\n${sourcesSection}` : answer;
    const markdownOptions = {
      prompt: query,
      turnMeta: { c: commandName },
      response,
      title,
      provider: getProviderLabel(providerUrl),
      providerLabel: strings['md.provider'] ?? 'Provider',
      promptLabel: strings['md.prompt'] ?? 'Prompt',
      responseLabel: strings['md.response'] ?? 'Response',
      timestampLabel: strings['md.timestamp'] ?? 'Time',
    };

    // A bot run must never land in the desktop's temporary chat: the two would overwrite
    // each other, and the requester would get nothing back on their phone.
    if (origin === 'app' && isTempChatMode()) {
      deliverTempChatResult({ content: buildOutputMarkdown(markdownOptions) });
      return { success: true, answer: response, title };
    }

    const filePath = await saveCommandOutput({
      conversationPath,
      markdownOptions,
      prompt: markdownOptions.prompt,
      response: markdownOptions.response,
      providerLabel: markdownOptions.provider,
      command: commandName,
      usage,
    });
    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
    return { success: true, filePath, answer: response, title };
  };

  const run = async (taskId?: string): Promise<SearchRunOutcome> => {
    try {
      const report = (progress: SearchProgress): void => {
        const text = progressText(progress, strings);
        if (taskId) flowManager?.setQueueTaskProgress(taskId, text);
        request.onProgressText?.(text);
      };
      const onProgress = taskId || request.onProgressText ? report : undefined;

      const deps = flowManager?.getExecutorDeps();
      if (deps) {
        onProgress?.({ stage: 'analyzing' });
        const { result: shortcut, usage: shortcutUsage } = await measureTokens(
          () => runUrlShortcut(query, resolvedTarget, deps, strings),
        );
        const shortcutAnswer = shortcut?.answer.trim() ?? '';
        if (shortcut && shortcutAnswer) {
          const shortcutTitle = pickConversationTitle({ resolved: shortcut.title, prompt: query });
          return await deliver(shortcutAnswer, shortcutTitle, shortcut.providerUrl, shortcutUsage);
        }
      }

      const { result: outcome, usage } = await measureTokens(
        () => runWebSearch(query, resolvedTarget, config.locale, onProgress, searchMode),
      );

      const sourcesSection = buildSourcesSection(outcome.sources, t(strings, 'search.output.sources'));
      return await deliver(
        outcome.answer.trim(),
        pickConversationTitle({ prompt: query }),
        resolvedTarget,
        usage,
        sourcesSection,
      );
    } catch (err: unknown) {
      const message = err instanceof SearchPipelineError
        ? t(strings, err.i18nKey)
        : localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);
      sendLog(`❌ [Search] ${message}`);
      return { success: false, error: message };
    }
  };

  if (!flowManager) return run();
  return flowManager.enqueueExternalTask(
    `/${commandName} ${summarizeQuery(query)}`,
    run,
    (err) => ({
      success: false,
      error: localizeUserFacingError(err instanceof Error ? err.message : String(err), strings),
    }),
    undefined,
    (request.clientToken ?? '').trim() || undefined,
  );
}
