import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Button, Flex, Group, Stack, Text } from '@mantine/core';
import { BookOpen, Quote, SearchCheck, X } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { MarkdownView } from '../components/MarkdownView';
import { ExportDialog } from '../components/ExportDialog';
import { FileHeaderBar } from '../components/chat/FileHeaderBar';
import { PromptInputArea, type PromptInputAreaHandle } from '../components/chat/PromptInputArea';
import { WelcomeScreen } from '../components/chat/WelcomeScreen';
import { IncognitoWelcome } from '../components/chat/IncognitoWelcome';
import { TempChatToggle } from '../components/chat/TempChatToggle';
import { ChatDropZone } from '../components/chat/ChatDropZone';
import { LoginRequiredDialog } from '../components/chat/LoginRequiredDialog';
import { ShareLinkDialog } from '../components/chat/ShareLinkDialog';
import { buildShareMarkdown } from '../../../shared/conversationDoc';
import { conversationAliases } from '../utils/parseMarkdownBlocks';
import { useShallow } from 'zustand/react/shallow';
import { NEW_CONVERSATION_KEY, selectHiddenSources, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useGlobalHotkeys } from '../hooks/useGlobalHotkeys';
import { usePromptAttachments } from '../hooks/usePromptAttachments';
import {
  useCaptureExport,
  CAPTURE_PALETTES,
  type ExportToast,
  type CaptureDirection,
} from '../hooks/useCaptureExport';
import { useExportSettingsStore } from '../store/exportSettingsStore';
import type { CaptureFormat, CaptureTurn } from '../../../shared/types';
import { useRewriteTask } from '../hooks/useRewriteTask';
import { useChatCommands, type ChatCommand } from '../hooks/useChatCommands';
import { useChatCommandRunner } from '../hooks/useChatCommandRunner';
import { useAgentRunner } from '../hooks/useAgentRunner';
import { useAgentRunStore } from '../store/useAgentRunStore';
import { useConversationTurns } from '../hooks/useConversationTurns';
import { ConversationView } from './chat/ConversationView';
import { AgentResumeBanner } from '../components/chat/AgentResumeBanner';
import { ConversationSearchOverlay } from '../components/chat/ConversationSearchOverlay';
import { SelectionToolbar, type SelectionAction } from '../components/chat/SelectionToolbar';
import { useChatSelection } from '../hooks/useChatSelection';
import { parseCitationSources, resolveSelectionCitations } from '../../../shared/citations';
import { accountApi, agentApi, fileApi, settingsApi, clipboardApi } from '../api/electronApi';
import { DEFAULT_MODEL_URL, nextModelUrl, visibleModels } from '../config/models';
import { DEFAULT_CHAT_MODE, type ChatMode } from '../config/chatModes';
import {
  BUILTIN_AGENT_COMMAND,
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_COMMAND,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_NEW_ALIAS,
  BUILTIN_NEW_COMMAND,
  BUILTIN_NEW_FLOW_ID,
  BUILTIN_QUICKSEARCH_ALIAS,
  BUILTIN_QUICKSEARCH_COMMAND,
  BUILTIN_QUICKSEARCH_FLOW_ID,
  BUILTIN_SEARCH_ALIAS,
  BUILTIN_SEARCH_COMMAND,
  BUILTIN_SEARCH_FLOW_ID,
  isByokTargetUrl,
  isModelUrlHidden,
  loginRequiredProviderForUrl,
} from '../../../shared/types';
import type { LoginRequiredProvider } from '../../../shared/types';
import type { ConversationDoc } from '../../../shared/conversationDoc';

const EMPTY_CONVERSATION: ConversationDoc = {
  title: null, provider: null, time: null, thread: { v: 1 }, turns: [],
};

export const ChatView: React.FC = React.memo(() => {
  const { selectedFile, fileContent, parsedBlocks, conversation, layoutMode, markdownZoom, tempChatMode, tempChatContent, tempChatBlocks, tempChatConversation } = useAppStore(
    useShallow((s) => ({
      selectedFile: s.selectedFile,
      fileContent: s.fileContent,
      parsedBlocks: s.parsedBlocks,
      conversation: s.conversation,
      layoutMode: s.layoutMode,
      markdownZoom: s.markdownZoom,
      tempChatMode: s.tempChatMode,
      tempChatContent: s.tempChatContent,
      tempChatBlocks: s.tempChatBlocks,
      tempChatConversation: s.tempChatConversation,
    })),
  );
  const { setFileContent, setFiles, selectFile, setLayoutMode, zoomInMarkdown, zoomOutMarkdown, resetMarkdownZoom, setAiUrl } = useAppStore(
    useShallow((s) => ({
      setFileContent: s.setFileContent,
      setFiles: s.setFiles,
      selectFile: s.selectFile,
      setLayoutMode: s.setLayoutMode,
      zoomInMarkdown: s.zoomInMarkdown,
      zoomOutMarkdown: s.zoomOutMarkdown,
      resetMarkdownZoom: s.resetMarkdownZoom,
      setAiUrl: s.setAiUrl,
    })),
  );
  const { t } = useI18nStore();
  const pendingNewTurns = useAppStore((s) => (s.pendingTurns[NEW_CONVERSATION_KEY] ?? []).length);
  const pendingSelectedTurns = useAppStore((s) => (s.pendingTurns[s.selectedFile?.path ?? ''] ?? []).length);

  // The picked model lives in the store, not here: `config.targetUrl` is what a
  // hotkey capture, a bot message and a flow LLM step with no provider of its own
  // all fall back to, so a pick kept locally would leave every one of those paths
  // on the previous provider — and would be forgotten on the next launch.
  const activeModelUrl = useAppStore((s) => s.aiUrl);
  const [chatMode, setChatMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [pendingLoginModel, setPendingLoginModel] = useState<{ provider: LoginRequiredProvider; url: string } | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportToast, setExportToast] = useState<ExportToast>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const shareMarkdown = useMemo(
    () => buildShareMarkdown(fileContent ?? '', conversationAliases()),
    [fileContent, t],
  );
  const [headerEditing, setHeaderEditing] = useState(false);
  const [headerEditValue, setHeaderEditValue] = useState('');

  const captureExport = useCaptureExport(setExportToast);
  const quickExportZip = useExportSettingsStore((s) => s.quick.zip);
  const { startRewrite } = useRewriteTask(setExportToast);

  const handleTurnError = useCallback((message: string): void => {
    setExportToast({ id: Date.now(), message: message || t('chat.command.error') });
  }, [t]);
  const { sendTurn } = useConversationTurns(handleTurnError);

  const flowCommands = useChatCommands();
  const chatCommands = useMemo<ChatCommand[]>(() => {
    const builtinNames = new Set([
      BUILTIN_NEW_COMMAND, BUILTIN_NEW_ALIAS,
      BUILTIN_CHAT_COMMAND,
      BUILTIN_SEARCH_COMMAND, BUILTIN_SEARCH_ALIAS,
      BUILTIN_QUICKSEARCH_COMMAND, BUILTIN_QUICKSEARCH_ALIAS,
      BUILTIN_AGENT_COMMAND,
    ]);
    return [
      {
        flowId: BUILTIN_NEW_FLOW_ID,
        command: BUILTIN_NEW_COMMAND,
        aliases: [BUILTIN_NEW_ALIAS],
        description: t('chat.command.new.description'),
        action: true,
      },
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
      {
        flowId: BUILTIN_SEARCH_FLOW_ID,
        command: BUILTIN_SEARCH_COMMAND,
        aliases: [BUILTIN_SEARCH_ALIAS],
        description: t('search.command.description'),
      },
      {
        flowId: BUILTIN_QUICKSEARCH_FLOW_ID,
        command: BUILTIN_QUICKSEARCH_COMMAND,
        aliases: [BUILTIN_QUICKSEARCH_ALIAS],
        description: t('quicksearch.command.description'),
      },
      ...flowCommands.filter((c) => !builtinNames.has(c.command)),
    ];
  }, [flowCommands, t]);
  const { runCommand } = useChatCommandRunner(setExportToast);
  const { run: runAgentCommand, resume: resumeAgentRun, discard: discardAgentRun } = useAgentRunner();
  const resumableAgentRuns = useAgentRunStore((s) => s.resumable);

  useEffect(() => {
    void agentApi.listResumable().then((list) => useAgentRunStore.getState().setResumable(list));
  }, []);

  const handleAgentResume = useCallback((runId: string): void => {
    useAgentRunStore.getState().removeResumable(runId);
    void resumeAgentRun(runId);
  }, [resumeAgentRun]);
  const handleAgentBannerDiscard = useCallback((runId: string): void => {
    useAgentRunStore.getState().removeResumable(runId);
    void discardAgentRun(runId);
  }, [discardAgentRun]);

  const handleUnknownCommand = useCallback((command: string): void => {
    setExportToast({ id: Date.now(), message: t('chat.command.notFound').replace('{{command}}', command) });
  }, [t]);

  const {
    attachments,
    notice: attachmentNotice,
    addFiles,
    removeAttachment,
    clearAttachments,
  } = usePromptAttachments(activeModelUrl, t);

  const promptAreaRef = useRef<PromptInputAreaHandle>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  const focusPromptInput = useCallback(() => {
    promptAreaRef.current?.focusPrompt();
  }, []);

  const handleNewConversation = useCallback((): void => {
    selectFile(null);
    setFileContent(null);
    focusPromptInput();
  }, [selectFile, setFileContent, focusPromptInput]);

  const openSearch = useCallback((): void => setSearchOpen(true), []);

  /** The one way the picked model changes: shown here, and persisted for everyone else. */
  const selectModel = useCallback((url: string): void => {
    if (useAppStore.getState().aiUrl === url) return;
    setAiUrl(url);
    void settingsApi.updateAiUrl(url);
  }, [setAiUrl]);

  const handleCycleModel = useCallback((): void => {
    const state = useAppStore.getState();
    selectModel(nextModelUrl(state.aiUrl, visibleModels(state, selectHiddenSources(state))));
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

  // Both repairs below wait for `aiUrlLoaded`: until the stored pick has arrived the
  // model is still the store's placeholder, and correcting that would persist over
  // the very value being loaded.
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

  useEffect(() => {
    if (!exportToast) return;
    const timer = window.setTimeout(() => setExportToast((cur) => (
      cur?.id === exportToast.id ? null : cur
    )), 4_500);
    return () => window.clearTimeout(timer);
  }, [exportToast]);

  useEffect(() => {
    setExportToast(null);
  }, [selectedFile?.path]);

  useEffect(() => {
    if (headerEditing) {
      window.requestAnimationFrame(() => headerInputRef.current?.select());
    }
  }, [headerEditing]);

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

  const handleRunChatCommand = useCallback((command: ChatCommand, input: string): boolean => {
    if (command.flowId === BUILTIN_NEW_FLOW_ID) {
      handleNewConversation();
      return true;
    }
    if (
      command.flowId === BUILTIN_SEARCH_FLOW_ID
      || command.flowId === BUILTIN_QUICKSEARCH_FLOW_ID
      || command.flowId === BUILTIN_AGENT_FLOW_ID
    ) {
      const gated = loginRequiredProviderForUrl(activeModelUrl);
      if (gated && useAppStore.getState().accountStatuses[gated] === false) {
        setPendingLoginModel({ provider: gated, url: activeModelUrl });
        return false;
      }
    }
    if (command.flowId === BUILTIN_AGENT_FLOW_ID) {
      if (!input.trim()) {
        setExportToast({ id: Date.now(), message: t('agent.error.empty') });
        return false;
      }
      void runAgentCommand(input, activeModelUrl);
      return true;
    }
    void runCommand(command, input, activeModelUrl);
    return true;
  }, [activeModelUrl, handleNewConversation, runCommand, runAgentCommand, t]);

  const handleAiUrlChange = useCallback((nextUrl: string): void => {
    const provider = loginRequiredProviderForUrl(nextUrl);
    if (provider && useAppStore.getState().accountStatuses[provider] === false) {
      setPendingLoginModel({ provider, url: nextUrl });
      return;
    }
    selectModel(nextUrl);
  }, [selectModel]);

  const handleLoginConfirm = useCallback((provider: LoginRequiredProvider): void => {
    if (pendingLoginModel) selectModel(pendingLoginModel.url);
    setPendingLoginModel(null);
    void accountApi.openLogin(provider);
  }, [pendingLoginModel, selectModel]);

  const handleCopyFullText = useCallback(async (): Promise<void> => {
    if (!fileContent) return;
    await clipboardApi.copyText(fileContent);
  }, [fileContent]);

  const startHeaderRename = useCallback(() => {
    const fileStem = selectedFile?.name.replace(/\.md$/i, '') ?? '';
    setHeaderEditValue(fileStem);
    setHeaderEditing(true);
  }, [selectedFile?.name]);

  const commitHeaderRename = useCallback(async () => {
    setHeaderEditing(false);
    const title = headerEditValue.trim();
    if (!title || !selectedFile) return;
    const result = await fileApi.updateTitle(selectedFile.path, title);
    if (!result.ok) return;
    const latest = await fileApi.getList();
    setFiles(latest);
    const nextSelected = latest.find((item) => item.path === result.updatedPath) ?? null;
    selectFile(nextSelected);
    if (!nextSelected) { setFileContent(null); return; }
    const updated = await fileApi.getContent(nextSelected.path);
    startTransition(() => setFileContent(updated));
  }, [headerEditValue, selectedFile, selectFile, setFileContent, setFiles]);

  const singleTurnDocumentView = layoutMode === 'side-by-side'
    && (conversation?.turns.length ?? 0) <= 1;

  const awaitingFirstTurn = pendingSelectedTurns > 0 && (conversation?.turns.length ?? 0) === 0;
  const showConversationView = Boolean(fileContent) && Boolean(conversation)
    && (awaitingFirstTurn || ((conversation?.turns.length ?? 0) > 0 && !singleTurnDocumentView));

  const handleCaptureTurnAs = useCallback(
    (format: CaptureFormat, turn: CaptureTurn) => captureExport.captureTurnAs(format, turn, quickExportZip),
    [captureExport, quickExportZip],
  );

  const handleStartRewrite = useCallback((url: string): void => {
    void startRewrite(url);
  }, [startRewrite]);

  // Whichever doc ConversationView is showing. It is what turns a `data-turn-index` back
  // into answer markdown, and so the only way a selection reaches the `/search` source
  // list — the single-turn document view renders the file rather than turns, and has none.
  const activeConversation = showConversationView && conversation
    ? conversation
    : (tempChatMode && (tempChatConversation?.turns.length ?? 0) > 0 ? tempChatConversation : null);

  const { selection, clear: clearSelection } = useChatSelection(contentAreaRef);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    setSourcesOpen(false);
  }, [selection?.text, selection?.turnIndex]);

  useEffect(() => {
    clearSelection();
    setSourcesOpen(false);
  }, [selectedFile?.path, clearSelection]);

  const selectionSources = useMemo(() => {
    if (!selection || selection.turnIndex === null || !activeConversation) return [];
    const response = activeConversation.turns[selection.turnIndex]?.response ?? '';
    if (!response) return [];
    return resolveSelectionCitations(selection.text, selection.blockText, parseCitationSources(response));
  }, [selection, activeConversation]);

  const searchChatCommand = useMemo(
    () => chatCommands.find((command) => command.flowId === BUILTIN_SEARCH_FLOW_ID) ?? null,
    [chatCommands],
  );

  // The second slot changes meaning with the turn, and must not claim more than it knows:
  // a cited passage can show the pages it came from, an uncited one can only be looked up.
  // Reporting a model's own account of its sources as provenance would be a lie.
  const selectionActions = useMemo<SelectionAction[]>(() => {
    if (!selection) return [];
    const actions: SelectionAction[] = [{
      id: 'quote',
      label: t('chat.selection.quote'),
      Icon: Quote,
      run: () => {
        promptAreaRef.current?.insertQuote(selection.text);
        clearSelection();
      },
    }];
    if (selectionSources.length > 0) {
      actions.push({
        id: 'sources',
        label: t('chat.selection.sources'),
        Icon: BookOpen,
        run: () => setSourcesOpen((open) => !open),
      });
    } else if (searchChatCommand) {
      actions.push({
        id: 'verify',
        label: t('chat.selection.verify'),
        Icon: SearchCheck,
        run: () => {
          if (handleRunChatCommand(searchChatCommand, selection.text)) clearSelection();
        },
      });
    }
    return actions;
  }, [selection, selectionSources, searchChatCommand, handleRunChatCommand, clearSelection, t]);

  const handleOpenSource = useCallback((url: string): void => {
    void clipboardApi.openExternalUrl(url);
  }, []);

  return (
    <Flex flex={1} style={{ overflow: 'hidden' }}>
      <Sidebar onNewConversation={handleNewConversation} onOpenSearch={openSearch} />

      <ChatDropZone onFiles={addFiles} overlayLabel={t('attach.drop.hint')}>
      <Stack gap={0} flex={1} pos="relative" bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
        {
}
        {!selectedFile && (
          <Box pos="absolute" top={10} right={14} style={{ zIndex: 50 }}>
            <TempChatToggle />
          </Box>
        )}
        {selectedFile && (
          <FileHeaderBar
            fileName={selectedFile.name}
            fileContentExists={Boolean(fileContent)}
            headerEditing={headerEditing}
            headerEditValue={headerEditValue}
            setHeaderEditValue={setHeaderEditValue}
            onCommitHeaderRename={() => { void commitHeaderRename(); }}
            onCancelHeaderRename={() => setHeaderEditing(false)}
            onStartHeaderRename={startHeaderRename}
            headerInputRef={headerInputRef}
            viewMenuRef={viewMenuRef}
            viewMenuOpen={viewMenuOpen}
            onToggleViewMenu={() => setViewMenuOpen((prev) => !prev)}
            onCloseViewMenu={() => setViewMenuOpen(false)}
            t={t}
            markdownZoom={markdownZoom}
            onZoomIn={zoomInMarkdown}
            onZoomOut={zoomOutMarkdown}
            onZoomReset={resetMarkdownZoom}
            layoutMode={layoutMode}
            onSetLayoutMode={setLayoutMode}
            onCopyFullText={() => { void handleCopyFullText(); }}
            onOpenCaptureDialog={() => captureExport.setCaptureDialogOpen(true)}
            onOpenShareDialog={() => setShareDialogOpen(true)}
            captureBusy={captureExport.captureBusy}
            onShowInFolder={() => { void window.electronAPI.showInFolder(selectedFile.path); }}
            onStartRewrite={handleStartRewrite}
          />
        )}

        <Box ref={contentAreaRef} flex={1} style={{ overflowY: 'auto' }}>
          {showConversationView && conversation ? (
            <ConversationView
              conversation={conversation}
              conversationPath={selectedFile?.path ?? ''}
              onCaptureTurnAs={handleCaptureTurnAs}
            />
          ) : fileContent && parsedBlocks ? (
            <MarkdownView content={fileContent} blocks={parsedBlocks} />
          ) : selectedFile ? (
            <Flex align="center" justify="center" h="100%" c="dimmed" fz="var(--font-size-md)">
              {t('main.loading')}
            </Flex>
          ) : tempChatMode && tempChatConversation && tempChatConversation.turns.length > 0 ? (
            <ConversationView conversation={tempChatConversation} conversationPath={NEW_CONVERSATION_KEY} />
          ) : pendingNewTurns > 0 ? (
            <ConversationView conversation={EMPTY_CONVERSATION} conversationPath={NEW_CONVERSATION_KEY} />
          ) : tempChatMode && tempChatContent && tempChatBlocks ? (
            <MarkdownView content={tempChatContent} blocks={tempChatBlocks} />
          ) : tempChatMode ? (
            <IncognitoWelcome />
          ) : (
            <WelcomeScreen activeModelUrl={activeModelUrl} />
          )}
        </Box>

        {resumableAgentRuns.length > 0 && (
          <Box px="md" pb="xs">
            <AgentResumeBanner
              runs={resumableAgentRuns}
              onResume={handleAgentResume}
              onDiscard={handleAgentBannerDiscard}
            />
          </Box>
        )}

        <PromptInputArea
          ref={promptAreaRef}
          t={t}
          activeModelUrl={activeModelUrl}
          onChangeModel={handleAiUrlChange}
          onSend={handleSendPrompt}
          attachments={attachments}
          notice={attachmentNotice}
          onRemoveAttachment={removeAttachment}
          chatCommands={chatCommands}
          onRunCommand={handleRunChatCommand}
          onUnknownCommand={handleUnknownCommand}
          chatMode={chatMode}
          onChangeMode={setChatMode}
        />
      </Stack>
      </ChatDropZone>

      {selection && selectionActions.length > 0 && (
        <SelectionToolbar
          selection={selection}
          actions={selectionActions}
          sources={selectionSources}
          sourcesOpen={sourcesOpen}
          sourcesLabel={t('chat.selection.sourcesTitle')}
          onOpenSource={handleOpenSource}
          t={t}
        />
      )}

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
        t={t}
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

      {exportToast && (
        <Stack
          gap={8}
          pos="fixed"
          right={14}
          bottom={14}
          miw={280}
          maw={400}
          bg="var(--mantine-color-default)"
          p={10}
          style={{
            zIndex: 120,
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-sm)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Group justify="space-between" gap={8}>
            <Text fz="var(--font-size-base)" fw={700} c="var(--mantine-color-text)">
              {exportToast.fileName ? `${exportToast.message} ${exportToast.fileName}` : exportToast.message}
            </Text>
            <ActionIcon variant="transparent" size="sm" c="dimmed" onClick={() => setExportToast(null)}
            >
              <X size={14} />
            </ActionIcon>
          </Group>
          {exportToast.filePath && (
            <Group gap={8}>
              <Button
                variant="default"
                size="compact-xs"
                onClick={() => void window.electronAPI.showInFolder(exportToast.filePath!)}
              >
                {t('capture.toast.openFolder')}
              </Button>
              <Button
                size="compact-xs"
                onClick={() => void window.electronAPI.openPath(exportToast.filePath!)}
              >
                {t('capture.toast.openNow')}
              </Button>
            </Group>
          )}
        </Stack>
      )}

    </Flex>
  );
});

