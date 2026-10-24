import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Stack } from '@mantine/core';
import { Paperclip } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { MarkdownView } from '../components/MarkdownView';
import { ExportDialog } from '../components/ExportDialog';
import { FileHeaderBar } from '../components/chat/FileHeaderBar';
import { headerTitleFor } from '../components/chat/headerMenu/headerMenuModel';
import { useHeaderTitleEdit } from '../components/chat/headerMenu/useHeaderTitleEdit';
import { ConversationInfoDialog } from '../components/chat/ConversationInfoDialog';
import { ConversationHistoryDialog } from '../components/chat/ConversationHistoryDialog';
import { CENTERED_MAX_WIDTH, PromptInputArea, type PromptInputAreaHandle } from '../components/chat/PromptInputArea';
import { WelcomeHints, WelcomeScreen } from '../components/chat/WelcomeScreen';
import { IncognitoHints, IncognitoWelcome } from '../components/chat/IncognitoWelcome';
import { ChatHeaderRow } from '../components/chat/ChatHeaderRow';
import { TempChatToggle } from '../components/chat/TempChatToggle';
import { FileDragArea, FileDropZone } from '../components/chat/FileDropZone';
import { LoginRequiredDialog } from '../components/chat/LoginRequiredDialog';
import { ShareLinkDialog } from '../components/chat/ShareLinkDialog';
import { buildShareMarkdown } from '../../../shared/conversationDoc';
import { conversationPlainMarkdown } from '../../../shared/conversationPlain';
import { isNotionDoc } from '../../../shared/notion/notionDoc';
import { conversationAliases } from '../utils/parseMarkdownBlocks';
import { loadAgentDefault, saveAgentDefault } from '../utils/composerDefaults';
import { useShallow } from 'zustand/react/shallow';
import { NEW_CONVERSATION_KEY, selectHiddenSources, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useGlobalHotkeys } from '../hooks/useGlobalHotkeys';
import { usePromptAttachments } from '../hooks/usePromptAttachments';
import { useRegionCaptureIntake } from '../hooks/useRegionCaptureIntake';
import { useGlideOnSwitch } from '../hooks/useGlideOnSwitch';
import {
  useCaptureExport,
  CAPTURE_PALETTES,
  type ExportToast,
  type CaptureDirection,
} from '../hooks/useCaptureExport';
import { hideAppNotices, showAppNotice } from '../hooks/useUiNotifications';
import { useExportSettingsStore } from '../store/exportSettingsStore';
import type { AgentRunSummary, CaptureFormat, CaptureTurn } from '../../../shared/types';
import { useRewriteTask } from '../hooks/useRewriteTask';
import { builtinChatCommand, commandGroup, useChatCommands, type ChatCommand } from '../hooks/useChatCommands';
import { useChatCommandRunner } from '../hooks/useChatCommandRunner';
import { useAgentRunner } from '../hooks/useAgentRunner';
import { useMcpCommands } from '../hooks/useMcpCommands';
import { useConversationConnectors, webForRun } from '../hooks/useConversationConnectors';
import { CHAT_BUILTIN_COMMAND_NAMES, MCP_COMMAND_ID_PREFIX, parseMcpCommandFlowId } from '../../../shared/mcpCommand';
import { useAgentRunStore } from '../store/useAgentRunStore';
import { useConversationTurns } from '../hooks/useConversationTurns';
import { ConversationView } from './chat/ConversationView';
import { DocumentView } from './document/DocumentView';
import { quoteIntoAssistant } from './document/docAssistantActions';
import { useDocAssistantStore } from '../store/docAssistantStore';
import { openFocusTarget } from '../utils/openFocus';
import type { PendingOpenFocus } from '../utils/openFocus';
import { plainNotionTitle } from '../../../shared/notion/notionDisplay';
import { shouldShowConversationView } from './chat/conversationViewRouting';
import { AgentResumeBanner } from '../components/chat/AgentResumeBanner';
import { RecapLine } from '../components/chat/RecapLine';
import { useConversationRecap } from '../hooks/useConversationRecap';
import { useFormatTime } from '../hooks/useFormatTime';
import { ConversationSearchOverlay } from '../components/chat/ConversationSearchOverlay';
import { ConversationFindBar } from '../components/chat/ConversationFindBar';
import { useConversationFindStore } from '../store/conversationFindStore';
import { useShortcutAction } from '../shortcuts/useShortcutAction';
import { SelectionTools } from '../components/chat/SelectionTools';
import { RewriteCardHost } from '../components/chat/RewriteCardHost';
import { TranslateConversationMenu } from '../components/chat/translate/TranslateConversationMenu';
import { ConversationTranslateStrip } from '../components/chat/translate/ConversationTranslateStrip';
import { useTranslateStore } from '../store/translateStore';
import { accountApi, agentApi, fileApi, settingsApi, clipboardApi } from '../api/electronApi';
import { DEFAULT_MODEL_URL, visibleModels } from '../config/models';
import { buildModelStops, nextModelStop, type ModelStop } from '../config/modelStops';
import { chooseModelStop, modelStopSources } from '../hooks/useModelStops';
import { chatModeForCapabilities, type ChatMode } from '../config/chatModes';
import {
  BUILTIN_AGENT_COMMAND,
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_COMMAND,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_MODEL_COMMAND,
  BUILTIN_MODEL_FLOW_ID,
  BUILTIN_NEW_ALIAS,
  BUILTIN_NEW_COMMAND,
  BUILTIN_NEW_FLOW_ID,
  BUILTIN_RECAP_COMMAND,
  BUILTIN_RECAP_FLOW_ID,
  isByokTargetUrl,
  isModelUrlHidden,
  loginRequiredProviderForUrl,
} from '../../../shared/types';
import type { LoginRequiredProvider } from '../../../shared/types';
import type { ConversationDoc } from '../../../shared/conversationDoc';
import { desktopAnalyzeIdFor, isDesktopBuiltinFlowId, xAnalyzeInput } from '../../../shared/builtinFlows';
import { fillTemplate } from '../../../shared/fillTemplate';

/** A selection longer than this is a passage, not something to search for. */
const FIND_PREFILL_MAX = 200;

const EMPTY_CONVERSATION: ConversationDoc = {
  title: null, provider: null, time: null, thread: { v: 1 }, turns: [],
};

export const ChatView: React.FC = React.memo(() => {
  const { selectedFile, fileContent, parsedBlocks, conversation, layoutMode, tempChatMode, tempChatContent, tempChatBlocks, tempChatConversation } = useAppStore(
    useShallow((s) => ({
      selectedFile: s.selectedFile,
      fileContent: s.fileContent,
      parsedBlocks: s.parsedBlocks,
      conversation: s.conversation,
      layoutMode: s.layoutMode,
      tempChatMode: s.tempChatMode,
      tempChatContent: s.tempChatContent,
      tempChatBlocks: s.tempChatBlocks,
      tempChatConversation: s.tempChatConversation,
    })),
  );
  const { setFileContent, selectFile, zoomInMarkdown, zoomOutMarkdown, resetMarkdownZoom, setAiUrl } = useAppStore(
    useShallow((s) => ({
      setFileContent: s.setFileContent,
      selectFile: s.selectFile,
      zoomInMarkdown: s.zoomInMarkdown,
      zoomOutMarkdown: s.zoomOutMarkdown,
      resetMarkdownZoom: s.resetMarkdownZoom,
      setAiUrl: s.setAiUrl,
    })),
  );
  const { t } = useI18nStore();
  const pendingNewTurns = useAppStore((s) => (s.pendingTurns[NEW_CONVERSATION_KEY] ?? []).length);
  const pendingSelectedTurns = useAppStore((s) => (s.pendingTurns[s.selectedFile?.path ?? ''] ?? []).length);

  // The conversation the recap is about: the open file, or the temporary chat when no file is open.
  const recapConversation = selectedFile ? conversation : (tempChatMode ? tempChatConversation : null);
  const conversationRecap = useConversationRecap({
    path: selectedFile?.path ?? NEW_CONVERSATION_KEY,
    conversation: recapConversation,
    pendingCount: selectedFile ? pendingSelectedTurns : pendingNewTurns,
  });
  const hasRecapTarget = (recapConversation?.turns.length ?? 0) > 0;
  const showRecapNow = conversationRecap.showNow;
  const formatTime = useFormatTime();

  const activeModelUrl = useAppStore((s) => s.aiUrl);
  // Reopening a conversation restores its capabilities; the mode follows from them, so nothing
  // has to be told about it separately.
  const noop = useCallback((): void => {}, []);
  const {
    connectors,
    activeIds: activeConnectorIds,
    web,
    webOff,
    toggleWeb,
    setWeb,
    optOutWeb,
    agent,
    setAgent,
    discloseAll: discloseConnectors,
    toggle: toggleConnector,
    remove: removeConnectors,
    clear: clearConnectors,
  } = useConversationConnectors(noop);
  // Agent is on when switched on by itself or implied by a capability; with none of them a send is
  // an ordinary chat turn — the only shape that can continue the provider's own thread natively.
  const chatMode = useMemo<ChatMode>(
    () => chatModeForCapabilities(agent, web, activeConnectorIds),
    [agent, web, activeConnectorIds],
  );
  const [pendingLoginModel, setPendingLoginModel] = useState<{ provider: LoginRequiredProvider; url: string } | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const translatingConversation = useTranslateStore((s) => s.conversation !== null);
  // A Notion document is shared as the page reads, not as questions and answers.
  const sharingDocument = Boolean(fileContent && isNotionDoc(fileContent));
  const shareMarkdown = useMemo(
    () => (sharingDocument ? conversationPlainMarkdown(fileContent ?? '', { unsupported: t('notion.block.unsupported') }) : buildShareMarkdown(fileContent ?? '', conversationAliases(), {
      question: (index) => fillTemplate(t('share.turnHeading'), { n: String(index) }),
      answer: (provider) => (provider
        ? fillTemplate(t('share.answerBy'), { provider })
        : t('share.answer')),
      intro: (provider, turns) => fillTemplate(t(provider ? 'share.introWith' : 'share.intro'), {
        provider: provider || '',
        count: String(turns),
      }),
    })),
    [fileContent, sharingDocument, t],
  );

  /* Everything this view has to say goes to the app's one notice surface, never a card of its own. */
  const setExportToast = useCallback((toast: ExportToast): void => {
    if (!toast) {
      hideAppNotices();
      return;
    }
    showAppNotice({
      message: toast.fileName ? `${toast.message} ${toast.fileName}` : toast.message,
      level: toast.level,
      filePath: toast.filePath,
    });
  }, []);

  const captureExport = useCaptureExport(setExportToast);
  const quickExportZip = useExportSettingsStore((s) => s.quick.zip);
  const { startRewrite } = useRewriteTask(setExportToast);

  const handleTurnError = useCallback((message: string): void => {
    setExportToast({ message: message || t('chat.command.error'), level: 'error' });
  }, [t]);
  const { sendTurn } = useConversationTurns(handleTurnError);

  const flowCommands = useChatCommands();
  const describeMcpCommand = useCallback(
    ({ connected }: { connected: boolean }) => (connected
      ? t('chat.command.mcp.description')
      : t('chat.command.mcp.disconnected')),
    [t],
  );
  // Flow commands and built-ins are reserved against connector commands inside the hook.
  const mcpCommands = useMcpCommands(describeMcpCommand);
  const chatCommands = useMemo<ChatCommand[]>(() => {
    return [
      {
        flowId: BUILTIN_NEW_FLOW_ID,
        command: BUILTIN_NEW_COMMAND,
        aliases: [BUILTIN_NEW_ALIAS],
        description: t('chat.command.new.description'),
        action: true,
      },
      {
        flowId: BUILTIN_MODEL_FLOW_ID,
        command: BUILTIN_MODEL_COMMAND,
        description: t('chat.command.model.description'),
      },
      // Only where there is a conversation to recap; on a blank chat a typed `/recap` is unknown.
      ...(hasRecapTarget ? [{
        flowId: BUILTIN_RECAP_FLOW_ID,
        command: BUILTIN_RECAP_COMMAND,
        description: t('chat.command.recap.description'),
        action: true as const,
      }] : []),
      {
        flowId: BUILTIN_CHAT_FLOW_ID,
        command: BUILTIN_CHAT_COMMAND,
        description: t('chat.command.chat.description'),
      },
      {
        flowId: BUILTIN_AGENT_FLOW_ID,
        command: BUILTIN_AGENT_COMMAND,
        description: t('agent.command.description'),
      },
      ...mcpCommands,
      ...flowCommands.filter((c) => !CHAT_BUILTIN_COMMAND_NAMES.has(c.command)),
    ];
  }, [flowCommands, mcpCommands, hasRecapTarget, t]);
  const { runCommand } = useChatCommandRunner(setExportToast);
  // Read through refs: a run reports back after it finishes, long after the callback was created.
  const webRef = useRef({ web, webOff });
  webRef.current = { web, webOff };
  const [autoWebSignal, setAutoWebSignal] = useState(0);
  // The agent went online with the web only off by default: the switch follows, with the same
  // undo notice a typed search request gets. Never against an "off" the user chose.
  const handleAgentUsedWeb = useCallback((): void => {
    if (webRef.current.web || webRef.current.webOff) return;
    setWeb(true);
    setAutoWebSignal((n) => n + 1);
  }, [setWeb]);
  // The composer turns the web on for a send that asked for a search, and off only from its notice's
  // undo — which is the user saying no, so it sticks to the conversation.
  const handleComposerSetWeb = useCallback((on: boolean): void => {
    if (on) setWeb(true);
    else optOutWeb();
  }, [setWeb, optOutWeb]);
  const {
    run: runAgentCommand,
    resume: resumeAgentRun,
    answer: answerAgentQuestion,
    discard: discardAgentRun,
  } = useAgentRunner(handleTurnError, handleAgentUsedWeb);
  const resumableAgentRuns = useAgentRunStore((s) => s.resumable);

  useEffect(() => {
    void agentApi.listResumable().then((list) => useAgentRunStore.getState().setResumable(list));
  }, []);

  const handleAgentResume = useCallback((entry: AgentRunSummary): void => {
    useAgentRunStore.getState().removeResumable(entry.runId);
    void resumeAgentRun(entry);
  }, [resumeAgentRun]);
  const handleAgentBannerDiscard = useCallback((runId: string): void => {
    useAgentRunStore.getState().removeResumable(runId);
    void discardAgentRun(runId);
  }, [discardAgentRun]);

  const handleUnknownCommand = useCallback((command: string): void => {
    setExportToast({ message: fillTemplate(t('chat.command.notFound'), { command }), level: 'warning' });
  }, [t]);

  const {
    attachments,
    unsupportedReason: attachUnsupportedReason,
    restriction: attachRestriction,
    accept: attachAccept,
    notice: attachmentNotice,
    addFiles,
    addFromClipboard,
    addStashed,
    removeAttachment,
    clearAttachments,
  } = usePromptAttachments(activeModelUrl, t);

  const promptAreaRef = useRef<PromptInputAreaHandle>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  /** The document view's scroll area, when a Notion document is open. */
  const documentAreaRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  const focusPromptInput = useCallback(() => {
    promptAreaRef.current?.focusPrompt();
  }, []);

  const handleNewConversation = useCallback((): void => {
    selectFile(null);
    setFileContent(null);
    // Disclosure is scoped to one conversation: a new one starts with nothing on the table —
    // web included, which is off by default and turned on per conversation. Agent is the one
    // exception: it starts as the user last picked it, so working in Agent is not a click per chat.
    clearConnectors();
    setWeb(false);
    setAgent(loadAgentDefault());
    focusPromptInput();
  }, [selectFile, setFileContent, clearConnectors, setWeb, setAgent, focusPromptInput]);

  // The blank chat the app opens on is a new conversation too.
  useEffect(() => {
    if (!useAppStore.getState().selectedFile) setAgent(loadAgentDefault());
  }, [setAgent]);

  // `/agent` and the menu's Agent row switch Agent on by itself — the web stays as it was, since an
  // agent needs no web. `/chat` and switching Agent off clear everything, capabilities included:
  // that is what makes an ordinary, natively-threaded turn reachable at all.
  const handleChangeMode = useCallback((mode: ChatMode): void => {
    if (mode === 'agent') {
      setAgent(true);
      return;
    }
    setAgent(false);
    setWeb(false);
    clearConnectors();
  }, [clearConnectors, setWeb, setAgent]);

  // The user's own pick is also what the next new chat starts in; an automatic switch is not.
  const handlePickMode = useCallback((mode: ChatMode): void => {
    handleChangeMode(mode);
    saveAgentDefault(mode === 'agent');
  }, [handleChangeMode]);

  const handleDiscloseConnectors = useCallback((ids: readonly string[]): readonly string[] =>
    discloseConnectors(ids), [discloseConnectors]);

  const handleDiscloseConnector = useCallback(
    (id: string): readonly string[] => handleDiscloseConnectors([id]),
    [handleDiscloseConnectors],
  );

  const handleToggleConnector = useCallback((id: string): void => {
    toggleConnector(id);
  }, [toggleConnector]);

  const openSearch = useCallback((): void => setSearchOpen(true), []);

  const selectModel = useCallback((url: string): void => {
    if (useAppStore.getState().aiUrl === url) return;
    setAiUrl(url);
    void settingsApi.updateAiUrl(url);
  }, [setAiUrl]);

  // Steps through each provider's own models too, not just the providers: stopping on one is the
  // same as picking its row in the model menu.
  const handleCycleModel = useCallback((): void => {
    const state = useAppStore.getState();
    const sources = modelStopSources(state);
    const next = nextModelStop(buildModelStops(sources), state.aiUrl, sources);
    if (!next) return;
    chooseModelStop(next);
    selectModel(next.url);
  }, [selectModel]);

  useGlobalHotkeys({
    contentAreaRef,
    onFocusPrompt: focusPromptInput,
    onCycleModel: handleCycleModel,
    onNewConversation: handleNewConversation,
    onOpenSearch: openSearch,
    zoomInMarkdown,
    zoomOutMarkdown,
    resetMarkdownZoom,
  });

  const tempModeFocusArmed = useRef(false);
  useEffect(() => {
    if (!tempModeFocusArmed.current) {
      tempModeFocusArmed.current = true;
      return;
    }
    focusPromptInput();
  }, [tempChatMode, focusPromptInput]);

  useEffect(() => {
    setViewMenuOpen(false);
  }, [selectedFile?.path]);

  const aiUrlLoaded = useAppStore((s) => s.aiUrlLoaded);

  const byokModels = useAppStore((s) => s.byokModels);
  const byokGroupModels = useAppStore((s) => s.byokGroupModels);
  const byokModelsLoaded = useAppStore((s) => s.byokModelsLoaded);
  useEffect(() => {
    if (!byokModelsLoaded || !aiUrlLoaded) return;
    if (!isByokTargetUrl(activeModelUrl)) return;
    const known = byokModels.some((m) => m.url === activeModelUrl)
      || byokGroupModels.some((m) => m.url === activeModelUrl);
    if (known) return;
    selectModel(DEFAULT_MODEL_URL);
  }, [activeModelUrl, byokModels, byokGroupModels, byokModelsLoaded, aiUrlLoaded, selectModel]);

  const hidden = useAppStore(useShallow(selectHiddenSources));
  const hiddenSourcesLoaded = useAppStore((s) => s.hiddenSourcesLoaded);
  useEffect(() => {
    if (!hiddenSourcesLoaded || !aiUrlLoaded) return;
    if (!isModelUrlHidden(activeModelUrl, hidden)) return;
    const next = visibleModels(useAppStore.getState(), hidden)[0];
    if (!next) return;
    selectModel(next.url);
  }, [activeModelUrl, hidden, hiddenSourcesLoaded, aiUrlLoaded, selectModel]);

  // The notices this window raised describe the conversation that was open; drop them when
  // the user moves to another one. Mantine owns the timers, so there is no interval to clear.
  useEffect(() => {
    hideAppNotices();
  }, [selectedFile?.path]);

  const handleSendPrompt = useCallback((text: string): boolean => {
    const gated = loginRequiredProviderForUrl(activeModelUrl);
    if (gated && useAppStore.getState().accountStatuses[gated] === false) {
      setPendingLoginModel({ provider: gated, url: activeModelUrl });
      return false;
    }
    const attachmentPaths = attachments.map((a) => a.path).filter(Boolean);
    sendTurn({
      prompt: text,
      targetUrl: activeModelUrl,
      ...(attachmentPaths.length > 0 ? { attachments: attachmentPaths } : {}),
    });
    if (attachments.length > 0) clearAttachments();
    return true;
  }, [activeModelUrl, attachments, clearAttachments, sendTurn]);

  const handleRunChatCommand = useCallback((
    command: ChatCommand,
    input: string,
    connectorIds?: readonly string[],
    webOverride?: boolean,
  ): boolean => {
    if (command.flowId === BUILTIN_NEW_FLOW_ID) {
      handleNewConversation();
      return true;
    }
    if (command.flowId === BUILTIN_RECAP_FLOW_ID) {
      showRecapNow();
      return true;
    }
    if (
      command.flowId === BUILTIN_AGENT_FLOW_ID
      || command.flowId.startsWith(MCP_COMMAND_ID_PREFIX)
    ) {
      const gated = loginRequiredProviderForUrl(activeModelUrl);
      if (gated && useAppStore.getState().accountStatuses[gated] === false) {
        setPendingLoginModel({ provider: gated, url: activeModelUrl });
        return false;
      }
    }
    const directConnector = parseMcpCommandFlowId(command.flowId);
    if (command.flowId === BUILTIN_AGENT_FLOW_ID || directConnector) {
      if (!input.trim()) {
        setExportToast({ message: t('agent.error.empty'), level: 'warning' });
        return false;
      }
      // `connectorIds` wins when the caller has just disclosed one: React has not flushed the
      // state update yet, so reading `activeConnectorIds` here would miss the connector the user
      // named in this very keystroke.
      const scope = connectorIds
        ?? (directConnector ? handleDiscloseConnector(directConnector) : activeConnectorIds);
      // Attachments ride along even with a connector disclosed: a connector run keeps the built-in file tools.
      const attachmentPaths = attachments.map((a) => a.path).filter(Boolean);
      // Web too: a send that has just turned it on has not flushed that into `web` either.
      void runAgentCommand(input, activeModelUrl, attachmentPaths, scope, webOverride ?? webForRun(web, webOff));
      if (attachmentPaths.length > 0) clearAttachments();
      return true;
    }
    void runCommand(command, input);
    return true;
  }, [
    activeModelUrl, attachments, clearAttachments, activeConnectorIds, handleDiscloseConnector,
    handleNewConversation, showRecapNow, runCommand, runAgentCommand, web, webOff, t,
  ]);

  // "Analyze" under a forwarded post: the post's site's built-in analysis — the post and its
  // replies read and summed up in one model call, no agent. The link was rebuilt from the post
  // id, so a hand-edited file can at most analyze a different post.
  const handleAnalyzeXPost = useCallback((link: string): void => {
    const flowId = desktopAnalyzeIdFor(link);
    if (flowId) void runCommand(builtinChatCommand(flowId), xAnalyzeInput(link));
  }, [runCommand]);

  // A flow's button carries its whole command line and runs that flow command again. Only a flow
  // command or a pasted link's built-in (a YouTube menu's choice, an X post's download): the line
  // comes from a file that may have been imported or edited, so it never starts the agent or a
  // connector, and never picks up the composer's attachments.
  const handleTurnButton = useCallback((commandLine: string): void => {
    const match = /^\/(\S+)\s*([\s\S]*)$/.exec(commandLine.trim());
    if (!match) return;
    if (isDesktopBuiltinFlowId(match[1])) {
      void runCommand(builtinChatCommand(match[1]), match[2].trim());
      return;
    }
    const name = match[1].toLowerCase();
    const command = chatCommands.find((c) => c.command.toLowerCase() === name || c.aliases?.some((a) => a.toLowerCase() === name));
    if (!command) {
      handleUnknownCommand(name);
      return;
    }
    if (commandGroup(command) !== 'flow') return;
    void runCommand(command, match[2].trim());
  }, [chatCommands, runCommand, handleUnknownCommand]);

  const handleAiUrlChange = useCallback((nextUrl: string): void => {
    const provider = loginRequiredProviderForUrl(nextUrl);
    if (provider && useAppStore.getState().accountStatuses[provider] === false) {
      setPendingLoginModel({ provider, url: nextUrl });
      return;
    }
    selectModel(nextUrl);
  }, [selectModel]);

  const handlePickModel = useCallback((stop: ModelStop): void => {
    chooseModelStop(stop);
    handleAiUrlChange(stop.url);
  }, [handleAiUrlChange]);

  const handleUnknownModel = useCallback((query: string): void => {
    setExportToast({ message: fillTemplate(t('chat.model.command.notFound'), { query }), level: 'warning' });
  }, [t]);

  const handleLoginConfirm = useCallback((provider: LoginRequiredProvider): void => {
    if (pendingLoginModel) selectModel(pendingLoginModel.url);
    setPendingLoginModel(null);
    void accountApi.openLogin(provider);
  }, [pendingLoginModel, selectModel]);

  // The header shows the conversation's H1, the sidebar row's title (the row's own while the
  // content loads), and its pencil edits that H1.
  // A Notion document's H1 is Notion's rich-text title ("**…**"): the header shows its words.
  const headerTitle = selectedFile
    ? (selectedFile.notion ? plainNotionTitle(headerTitleFor(fileContent, selectedFile)) : headerTitleFor(fileContent, selectedFile))
    : '';

  const writeHeaderTitle = useCallback(async (path: string, title: string): Promise<void> => {
    if (!await fileApi.updateH1(path, title)) return;
    // Main broadcasts the new file list, which updates the sidebar row; the open conversation is
    // re-read here, unless the user has moved to another one meanwhile.
    if (useAppStore.getState().selectedFile?.path !== path) return;
    const updated = await fileApi.getContent(path);
    if (useAppStore.getState().selectedFile?.path !== path) return;
    startTransition(() => setFileContent(updated));
  }, [setFileContent]);

  // Unchanged is no edit (a file without an H1 would otherwise gain one named after the file), and
  // the edit is dropped when another conversation opens: see useHeaderTitleEdit.
  const headerEdit = useHeaderTitleEdit({
    path: selectedFile?.path ?? null,
    title: headerTitle,
    writeTitle: writeHeaderTitle,
  });

  useEffect(() => {
    if (headerEdit.editing) {
      window.requestAnimationFrame(() => headerInputRef.current?.select());
    }
  }, [headerEdit.editing]);

  // Closing the info dialog returns focus to the ⋮ it was opened from; the menu row it came from is gone.
  const focusMoreButton = useCallback(() => {
    viewMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const showConversationView = shouldShowConversationView({
    layoutMode,
    turnCount: conversation?.turns.length ?? 0,
    pendingTurnCount: pendingSelectedTurns,
    hasContent: Boolean(fileContent) && Boolean(conversation),
  });
  // True exactly when the content area below falls through to one of the two welcome screens.
  // The composer then rises to sit under the greeting, as on the providers' own home pages.
  const blankChat = !(showConversationView && conversation)
    && !(fileContent && parsedBlocks)
    && !selectedFile
    && !(tempChatMode && tempChatConversation && tempChatConversation.turns.length > 0)
    && pendingNewTurns === 0
    && !(tempChatMode && tempChatContent && tempChatBlocks);
  // The first send (or opening a conversation) glides the composer down to the bottom edge
  // instead of jumping there; a new chat glides it back up under the greeting.
  const composerRef = useRef<HTMLDivElement>(null);
  useGlideOnSwitch(composerRef, blankChat);

  const handleCaptureTurnAs = useCallback(
    (format: CaptureFormat, turn: CaptureTurn) => captureExport.captureTurnAs(format, turn, quickExportZip),
    [captureExport, quickExportZip],
  );

  const handleStartRewrite = useCallback((url: string): void => {
    void startRewrite(url);
  }, [startRewrite]);

  // A Notion document (`notionConversation`) is shown by the document view, as one answer.
  const documentConversation = selectedFile && fileContent && conversation?.thread.notion && conversation.provider === 'Notion'
    ? conversation
    : null;
  // A click in the sidebar opened a file: the caret follows to its input box once it has loaded —
  // the composer for a conversation, the writing assistant's box for a Notion document.
  const [pendingOpenFocus, setPendingOpenFocus] = useState<PendingOpenFocus | null>(null);
  const handleOpenedByClick = useCallback((path: string): void => {
    focusPromptInput();
    setPendingOpenFocus({ path, held: document.activeElement });
  }, [focusPromptInput]);
  const assistantOpen = useDocAssistantStore((s) => s.open);
  useEffect(() => {
    const target = openFocusTarget({
      pending: pendingOpenFocus,
      selectedPath: selectedFile?.path,
      loaded: fileContent !== null,
      isDocument: documentConversation !== null,
      assistantOpen,
      active: document.activeElement,
      body: document.body,
    });
    if (target === 'wait' || !pendingOpenFocus) return;
    setPendingOpenFocus(null);
    if (target === 'chat') focusPromptInput();
    else if (target === 'assistant') useDocAssistantStore.getState().requestFocus();
  }, [pendingOpenFocus, selectedFile?.path, fileContent, documentConversation, assistantOpen, focusPromptInput]);

  useRegionCaptureIntake({
    addStashed,
    composerHidden: documentConversation !== null,
    onNewConversation: handleNewConversation,
    focusComposer: focusPromptInput,
  });

  const activeConversation = documentConversation ?? (showConversationView && conversation
    ? conversation
    : (tempChatMode && (tempChatConversation?.turns.length ?? 0) > 0 ? tempChatConversation : null));

  // Ctrl+F finds in the conversation on screen; with none open there is nothing to search in, so
  // it opens the conversation search instead.
  // A selected file counts while it loads, or a search opened from Ctrl+K would close as it lands.
  const hasConversationOnScreen = activeConversation !== null || Boolean(selectedFile);
  useShortcutAction('nav.find', () => {
    if (!hasConversationOnScreen) {
      openSearch();
      return;
    }
    const selected = window.getSelection();
    const text = selected && contentAreaRef.current?.contains(selected.anchorNode) ? selected.toString().trim() : '';
    useConversationFindStore.getState().show(text && text.length <= FIND_PREFILL_MAX && !text.includes('\n') ? text : undefined);
  }, 'chat');
  useEffect(() => {
    if (!hasConversationOnScreen) useConversationFindStore.getState().close();
  }, [hasConversationOnScreen]);

  // "Verify this" hands the claim to the agent, which decides whether to research it.
  const verifyChatCommand = useMemo(
    () => chatCommands.find((command) => command.flowId === BUILTIN_AGENT_FLOW_ID) ?? null,
    [chatCommands],
  );
  const handleVerifySelection = useMemo(
    () => (verifyChatCommand ? (text: string) => handleRunChatCommand(verifyChatCommand, text) : null),
    [verifyChatCommand, handleRunChatCommand],
  );
  const handleQuoteSelection = useCallback((text: string): void => {
    promptAreaRef.current?.insertQuote(text);
  }, []);
  const selectedPath = selectedFile?.path ?? null;
  const handleQuoteIntoAssistant = useCallback((text: string): void => {
    if (selectedPath) quoteIntoAssistant(selectedPath, text);
  }, [selectedPath]);

  const handleOpenSource = useCallback((url: string): void => {
    void clipboardApi.openExternalUrl(url);
  }, []);

  return (
    <FileDragArea>
      <Sidebar onNewConversation={handleNewConversation} onOpenSearch={openSearch} onOpenedByClick={handleOpenedByClick} />

      {documentConversation && selectedFile && fileContent && (
        <DocumentView
          key={selectedFile.path}
          path={selectedFile.path}
          content={fileContent}
          conversation={documentConversation}
          contentAreaRef={documentAreaRef}
          titleEdit={{
            title: headerTitle,
            titleEditing: headerEdit.editing,
            titleEditValue: headerEdit.value,
            setTitleEditValue: headerEdit.setValue,
            onCommitTitleEdit: headerEdit.commit,
            onCancelTitleEdit: headerEdit.cancel,
            onStartTitleEdit: headerEdit.start,
            titleInputRef: headerInputRef,
          }}
          onOpenHistory={() => setHistoryDialogOpen(true)}
          captureBusy={captureExport.captureBusy}
          onOpenCaptureDialog={() => captureExport.setCaptureDialogOpen(true)}
          onOpenShareDialog={() => setShareDialogOpen(true)}
          t={t}
        />
      )}
      {/* Under a document the chat column stays mounted, only hidden: the composer keeps what was typed. */}
      <Box display={documentConversation ? 'none' : 'flex'} flex={1} miw={0}>
      <FileDropZone
        grow
        onFiles={addFiles}
        icon={Paperclip}
        title={t('attach.drop.title')}
        detail={attachUnsupportedReason ?? attachRestriction ?? t('attach.drop.detail')}
      >
      <Stack gap={0} flex={1} pos="relative" bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
        {!selectedFile && (
          <ChatHeaderRow>
            <Box ml="auto">
              <TempChatToggle />
            </Box>
          </ChatHeaderRow>
        )}
        {selectedFile && (
          <FileHeaderBar
            title={headerTitle}
            filePath={selectedFile.path}
            fileContent={fileContent}
            conversation={conversation}
            titleEditing={headerEdit.editing}
            titleEditValue={headerEdit.value}
            setTitleEditValue={headerEdit.setValue}
            onCommitTitleEdit={headerEdit.commit}
            onCancelTitleEdit={headerEdit.cancel}
            onStartTitleEdit={headerEdit.start}
            titleInputRef={headerInputRef}
            viewMenuRef={viewMenuRef}
            viewMenuOpen={viewMenuOpen}
            onToggleViewMenu={() => setViewMenuOpen((prev) => !prev)}
            onCloseViewMenu={() => setViewMenuOpen(false)}
            t={t}
            onOpenCaptureDialog={() => captureExport.setCaptureDialogOpen(true)}
            onOpenShareDialog={() => setShareDialogOpen(true)}
            captureBusy={captureExport.captureBusy}
            onStartRewrite={handleStartRewrite}
            {...(fileContent && conversation && conversation.turns.length > 0
              ? { onOpenInfo: () => setInfoDialogOpen(true) }
              : {})}
            {...(fileContent ? { onOpenHistory: () => setHistoryDialogOpen(true) } : {})}
            translateMenuLabel={t('chat.translate.conversation.menu')}
            translateMenu={conversation && conversation.turns.length > 0 ? (
              <TranslateConversationMenu
                path={selectedFile.path}
                conversation={conversation}
                onClose={() => setViewMenuOpen(false)}
                t={t}
              />
            ) : undefined}
          />
        )}

        {/* Always rendered, so the composer below keeps its place in the tree and never remounts. */}
        <Box flex={blankChat ? 1 : 0} />
        <Box ref={contentAreaRef} flex={blankChat ? '0 0 auto' : 1} style={{ overflowY: 'auto' }}>
          <ConversationFindBar
            containerRef={contentAreaRef}
            resetKey={selectedFile?.path ?? NEW_CONVERSATION_KEY}
            onClosed={focusPromptInput}
            t={t}
          />
          {/* A document is drawn by DocumentView; drawing it here too would leave a second rewrite slot in the page. */}
          {documentConversation ? null : showConversationView && conversation ? (
            <ConversationView
              conversation={conversation}
              conversationPath={selectedFile?.path ?? ''}
              onCaptureTurnAs={handleCaptureTurnAs}
              onChooseAnswer={answerAgentQuestion}
              onTurnButton={handleTurnButton}
              onAnalyzeXPost={handleAnalyzeXPost}
            />
          ) : fileContent && parsedBlocks ? (
            <MarkdownView content={fileContent} blocks={parsedBlocks} />
          ) : selectedFile ? (
            <Flex align="center" justify="center" h="100%" c="dimmed" fz="var(--font-size-md)">
              {t('main.loading')}
            </Flex>
          ) : tempChatMode && tempChatConversation && tempChatConversation.turns.length > 0 ? (
            <ConversationView conversation={tempChatConversation} conversationPath={NEW_CONVERSATION_KEY} onChooseAnswer={answerAgentQuestion} onTurnButton={handleTurnButton} onAnalyzeXPost={handleAnalyzeXPost} />
          ) : pendingNewTurns > 0 ? (
            <ConversationView conversation={EMPTY_CONVERSATION} conversationPath={NEW_CONVERSATION_KEY} />
          ) : tempChatMode && tempChatContent && tempChatBlocks ? (
            <MarkdownView content={tempChatContent} blocks={tempChatBlocks} />
          ) : tempChatMode ? (
            <IncognitoWelcome />
          ) : (
            <WelcomeScreen />
          )}
        </Box>

        <Box px="md" pb={translatingConversation ? 'xs' : 0}>
          <ConversationTranslateStrip t={t} />
        </Box>

        {conversationRecap.display && (
          <Box px="md" pb="xs">
            <RecapLine
              title={t('chat.recap.title')}
              lines={conversationRecap.display === 'recap' ? conversationRecap.recap?.lines ?? [] : []}
              emptyText={t('chat.recap.empty')}
              timeLabel={conversationRecap.display === 'recap' && conversationRecap.recap?.at
                ? formatTime(conversationRecap.recap.at)
                : ''}
              dismissLabel={t('chat.recap.dismiss')}
              onDismiss={conversationRecap.dismiss}
            />
          </Box>
        )}

        {resumableAgentRuns.length > 0 && (
          // Lined up with the composer's own box: same 12px inset, same width when it is centred.
          <Box px={12} pb={4} w="100%" maw={blankChat ? CENTERED_MAX_WIDTH : undefined} mx={blankChat ? 'auto' : undefined}>
            <AgentResumeBanner
              runs={resumableAgentRuns}
              onResume={handleAgentResume}
              onDiscard={handleAgentBannerDiscard}
            />
          </Box>
        )}

        <Box ref={composerRef} style={{ flexShrink: 0 }}>
        <PromptInputArea
          ref={promptAreaRef}
          t={t}
          activeModelUrl={activeModelUrl}
          onChangeModel={handleAiUrlChange}
          onPickModel={handlePickModel}
          onUnknownModel={handleUnknownModel}
          onSend={handleSendPrompt}
          attachments={attachments}
          notice={attachmentNotice}
          onAddFiles={addFiles}
          onAddFromClipboard={addFromClipboard}
          attachUnsupportedReason={attachUnsupportedReason}
          attachAccept={attachAccept}
          onRemoveAttachment={removeAttachment}
          chatCommands={chatCommands}
          onRunCommand={handleRunChatCommand}
          onUnknownCommand={handleUnknownCommand}
          chatMode={chatMode}
          web={web}
          onToggleWeb={toggleWeb}
          onSetWeb={handleComposerSetWeb}
          autoWebSignal={autoWebSignal}
          onChangeMode={handleChangeMode}
          onPickMode={handlePickMode}
          connectors={connectors}
          activeConnectorIds={activeConnectorIds}
          onToggleConnector={handleToggleConnector}
          onDiscloseConnectors={handleDiscloseConnectors}
          onRemoveConnectors={removeConnectors}
          centered={blankChat}
        />
        </Box>
        <Box flex={blankChat ? 1.25 : 0}>
          {blankChat && (tempChatMode ? <IncognitoHints /> : <WelcomeHints />)}
        </Box>
      </Stack>
      </FileDropZone>
      </Box>

      <SelectionTools
        contentAreaRef={documentConversation ? documentAreaRef : contentAreaRef}
        conversation={activeConversation}
        path={selectedFile?.path ?? NEW_CONVERSATION_KEY}
        canEdit={Boolean(selectedFile) && pendingSelectedTurns === 0}
        notion={Boolean(documentConversation)}
        // A document quotes into its assistant panel; it has no agent run to verify with.
        onQuote={documentConversation ? handleQuoteIntoAssistant : handleQuoteSelection}
        onVerify={documentConversation ? null : handleVerifySelection}
        onOpenSource={handleOpenSource}
        t={t}
      />
      <RewriteCardHost path={selectedFile?.path ?? NEW_CONVERSATION_KEY} t={t} />

      <ConversationSearchOverlay opened={searchOpen} onClose={() => setSearchOpen(false)} />

      <LoginRequiredDialog
        provider={pendingLoginModel?.provider ?? null}
        t={t}
        onCancel={() => setPendingLoginModel(null)}
        onConfirm={handleLoginConfirm}
      />

      <ShareLinkDialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        markdown={shareMarkdown}
        turnCount={sharingDocument ? 0 : conversation?.turns.length ?? 0}
        t={t}
      />

      <ConversationInfoDialog
        open={infoDialogOpen && Boolean(selectedFile)}
        onClose={() => setInfoDialogOpen(false)}
        onClosed={focusMoreButton}
        conversation={conversation}
        content={fileContent ?? ''}
        filePath={selectedFile?.path ?? ''}
      />

      <ConversationHistoryDialog
        open={historyDialogOpen && Boolean(selectedFile)}
        onClose={() => setHistoryDialogOpen(false)}
        filePath={selectedFile?.path ?? ''}
        content={fileContent ?? ''}
        conversation={conversation}
      />

      <ExportDialog
        open={captureExport.captureDialogOpen}
        palettes={CAPTURE_PALETTES}
        selectedPalette={captureExport.capturePaletteKey}
        setSelectedPalette={captureExport.setCapturePaletteKey}
        backgroundStyle={captureExport.captureBackgroundStyle}
        setBackgroundStyle={captureExport.setCaptureBackgroundStyle}
        direction={captureExport.captureDirection}
        setDirection={(value) => captureExport.setCaptureDirection(value as CaptureDirection)}
        showPrompt={captureExport.captureShowPrompt}
        setShowPrompt={captureExport.setCaptureShowPrompt}
        showProvider={captureExport.captureShowProvider}
        setShowProvider={captureExport.setCaptureShowProvider}
        showTimestamp={captureExport.captureShowTimestamp}
        setShowTimestamp={captureExport.setCaptureShowTimestamp}
        showTokens={captureExport.captureShowTokens}
        setShowTokens={captureExport.setCaptureShowTokens}
        title={captureExport.captureTitle}
        setTitle={captureExport.setCaptureTitle}
        fileName={captureExport.captureFileName}
        setFileName={captureExport.setCaptureFileName}
        format={captureExport.captureFormat}
        setFormat={captureExport.setCaptureFormat}
        cardLayout={captureExport.captureCardLayout}
        setCardLayout={captureExport.setCaptureCardLayout}
        range={captureExport.captureRange}
        setRange={captureExport.setCaptureRange}
        turnCount={captureExport.captureTurnCount}
        width={captureExport.captureWidth}
        setWidth={captureExport.setCaptureWidth}
        margin={captureExport.captureMargin}
        setMargin={captureExport.setCaptureMargin}
        hiDpi={captureExport.captureHiDpi}
        setHiDpi={captureExport.setCaptureHiDpi}
        zip={captureExport.captureZip}
        setZip={captureExport.setCaptureZip}
        request={captureExport.captureRequest}
        t={t}
        busy={captureExport.captureBusy}
        busyMode={captureExport.captureBusyMode}
        onCopy={() => { void captureExport.handleCaptureImage('copy'); }}
        onSave={() => { void captureExport.handleCaptureImage('save'); }}
        onCancel={() => captureExport.setCaptureDialogOpen(false)}
      />


    </FileDragArea>
  );
});

