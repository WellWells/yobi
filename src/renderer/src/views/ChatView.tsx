import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Button, Flex, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { RefreshCw, X } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { MarkdownView } from '../components/MarkdownView';
import { ExportDialog } from '../components/ExportDialog';
import { FileHeaderBar } from '../components/chat/FileHeaderBar';
import { ModelDropdown } from '../components/chat/ModelDropdown';
import { PromptInputArea, type PromptInputAreaHandle } from '../components/chat/PromptInputArea';
import { WelcomeScreen } from '../components/chat/WelcomeScreen';
import { IncognitoWelcome } from '../components/chat/IncognitoWelcome';
import { TempChatToggle } from '../components/chat/TempChatToggle';
import { ChatDropZone } from '../components/chat/ChatDropZone';
import { LoginRequiredDialog } from '../components/chat/LoginRequiredDialog';
import { useShallow } from 'zustand/react/shallow';
import { selectHiddenSources, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useGlobalHotkeys } from '../hooks/useGlobalHotkeys';
import { usePromptAttachments } from '../hooks/usePromptAttachments';
import {
  useCaptureExport,
  CAPTURE_PALETTES,
  type ExportToast,
  type CaptureDirection,
} from '../hooks/useCaptureExport';
import { useRewriteTask } from '../hooks/useRewriteTask';
import { useChatCommands } from '../hooks/useChatCommands';
import { useChatCommandRunner } from '../hooks/useChatCommandRunner';
import { accountApi, fileApi, settingsApi, clipboardApi, promptApi } from '../api/electronApi';
import { DEFAULT_MODEL_URL, nextModelUrl, visibleModels } from '../config/models';
import { isByokTargetUrl, isModelUrlHidden, loginRequiredProviderForUrl } from '../../../shared/types';
import type { LoginRequiredProvider } from '../../../shared/types';

const RewriteTriggerButton = React.memo<{
  onStart: (url: string) => void;
  title: string;
}>(({ onStart, title }) => (
  <ModelDropdown
    value=""
    onChange={onStart}
    menuDirection="down"
    renderTrigger={({ toggle, open }) => (
      <Tooltip label={title} position="bottom">
        <ActionIcon
          onClick={toggle}
          aria-label={title}
          variant="transparent"
          size="sm"
          opacity={open ? 1 : 0.7}
        >
          <RefreshCw size={16} />
        </ActionIcon>
      </Tooltip>
    )}
  />
));

export const ChatView: React.FC = React.memo(() => {
  const { selectedFile, fileContent, parsedBlocks, layoutMode, markdownZoom, tempChatMode, tempChatContent, tempChatBlocks } = useAppStore(
    useShallow((s) => ({
      selectedFile: s.selectedFile,
      fileContent: s.fileContent,
      parsedBlocks: s.parsedBlocks,
      layoutMode: s.layoutMode,
      markdownZoom: s.markdownZoom,
      tempChatMode: s.tempChatMode,
      tempChatContent: s.tempChatContent,
      tempChatBlocks: s.tempChatBlocks,
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

  const [activeModelUrl, setActiveModelUrl] = useState(() => useAppStore.getState().aiUrl);
  const [pendingLoginModel, setPendingLoginModel] = useState<{ provider: LoginRequiredProvider; url: string } | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [exportToast, setExportToast] = useState<ExportToast>(null);
  const [headerEditing, setHeaderEditing] = useState(false);
  const [headerEditValue, setHeaderEditValue] = useState('');

  const captureExport = useCaptureExport(setExportToast);
  const { startRewrite } = useRewriteTask(setExportToast);

  const chatCommands = useChatCommands();
  const { runCommand, runningCommand } = useChatCommandRunner(setExportToast);
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

  // Reads models from the store at call time so the callback stays stable; the cycle
  // order comes from visibleModels, the same helper the dropdowns render from, so a
  // hidden provider is never cycled into.
  const handleCycleModel = useCallback((): void => {
    const state = useAppStore.getState();
    setActiveModelUrl((prev) => nextModelUrl(prev, visibleModels(state, selectHiddenSources(state))));
  }, []);

  useGlobalHotkeys({
    contentAreaRef,
    onFocusPrompt: focusPromptInput,
    onCycleModel: handleCycleModel,
    zoomInMarkdown,
    zoomOutMarkdown,
    resetMarkdownZoom,
  });

  // Toggling temporary chat mode drops the user straight into typing. Skip the
  // initial mount so app startup doesn't steal focus.
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

  // A BYOK key or group can disappear underneath the locally-held selection
  // (deleted in Settings, wiped by reset/import). Without this sync the
  // dropdown would fall back to displaying Gemini while sends still target the
  // dead byok:// / byokgroup:// URL — and the next send would re-persist that
  // dangling URL into config.targetUrl, undoing the main-side cleanup.
  const byokModels = useAppStore((s) => s.byokModels);
  const byokGroupModels = useAppStore((s) => s.byokGroupModels);
  const byokModelsLoaded = useAppStore((s) => s.byokModelsLoaded);
  useEffect(() => {
    if (!byokModelsLoaded) return;
    const known = (url: string): boolean =>
      byokModels.some((m) => m.url === url) || byokGroupModels.some((m) => m.url === url);
    setActiveModelUrl((prev) => {
      if (!isByokTargetUrl(prev) || known(prev)) return prev;
      const storeAiUrl = useAppStore.getState().aiUrl;
      const storeAiUrlDangling = isByokTargetUrl(storeAiUrl) && !known(storeAiUrl);
      return storeAiUrlDangling ? DEFAULT_MODEL_URL : storeAiUrl;
    });
  }, [byokModels, byokGroupModels, byokModelsLoaded]);

  // Hiding the model the chat is currently on must move the chat off it. The switch
  // is persisted, not just local: hotkey tasks read config.targetUrl, so a local-only
  // change would keep firing the very provider the user just hid.
  const hidden = useAppStore(useShallow(selectHiddenSources));
  const hiddenSourcesLoaded = useAppStore((s) => s.hiddenSourcesLoaded);
  useEffect(() => {
    if (!hiddenSourcesLoaded) return;
    if (!isModelUrlHidden(activeModelUrl, hidden)) return;
    // The settings UI blocks hiding the last visible source, so this is only empty
    // while the byok lists are still hydrating.
    const next = visibleModels(useAppStore.getState(), hidden)[0];
    if (!next) return;
    setActiveModelUrl(next.url);
    void settingsApi.updateAiUrl(next.url).then(() => setAiUrl(next.url));
  }, [activeModelUrl, hidden, hiddenSourcesLoaded, setAiUrl]);


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

  // Returns false when the login gate refused the send, which keeps the prompt (and any
  // attachments) in the composer instead of dropping the user's text on the floor. The gate
  // decides synchronously so the caller can act on the answer before it clears its input.
  const handleSendPrompt = useCallback((text: string): boolean => {
    // The selection gate cannot cover a model that was already active on launch, nor one
    // reached by the Shift+Tab cycle, so send is the second place worth asking.
    const gated = loginRequiredProviderForUrl(activeModelUrl);
    if (gated && useAppStore.getState().accountStatuses[gated] === false) {
      setPendingLoginModel({ provider: gated, url: activeModelUrl });
      return false;
    }
    void (async () => {
      const currentModelUrl = useAppStore.getState().aiUrl;
      if (activeModelUrl !== currentModelUrl) {
        await settingsApi.updateAiUrl(activeModelUrl);
        setAiUrl(activeModelUrl);
      }
      const attachmentPaths = attachments.map((a) => a.path).filter(Boolean);
      promptApi.triggerWithOptions({
        prompt: text,
        targetUrl: activeModelUrl,
        ...(attachmentPaths.length > 0 ? { attachments: attachmentPaths } : {}),
      });
      if (attachments.length > 0) clearAttachments();
    })();
    return true;
  }, [activeModelUrl, attachments, clearAttachments, setAiUrl]);

  // Switching to a model that cannot answer without an account asks first, and only
  // commits the switch once the user opts into signing in. Cancelling leaves the previous
  // model selected because the switch was never applied. A status of null (first check
  // still in flight) lets the switch through; the provider re-checks before sending.
  const handleAiUrlChange = useCallback((nextUrl: string): void => {
    const provider = loginRequiredProviderForUrl(nextUrl);
    if (provider && useAppStore.getState().accountStatuses[provider] === false) {
      setPendingLoginModel({ provider, url: nextUrl });
      return;
    }
    setActiveModelUrl(nextUrl);
  }, []);

  const handleLoginConfirm = useCallback((provider: LoginRequiredProvider): void => {
    if (pendingLoginModel) setActiveModelUrl(pendingLoginModel.url);
    setPendingLoginModel(null);
    void accountApi.openLogin(provider);
  }, [pendingLoginModel]);

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

  const rewriteHeaderAction = useMemo(() => {
    if (!selectedFile || !fileContent) return undefined;
    return (
      <RewriteTriggerButton
        onStart={(url) => { void startRewrite(url); }}
        title={t('rewrite.open')}
      />
    );
  }, [selectedFile, fileContent, startRewrite, t]);

  return (
    <Flex flex={1} style={{ overflow: 'hidden' }}>
      <Sidebar />

      <ChatDropZone onFiles={addFiles} overlayLabel={t('attach.drop.hint')}>
      <Stack gap={0} flex={1} pos="relative" bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
        {/* With no file open there is no header bar — pin the toggle to the
            pane's top-right corner so it stays reachable in every state. */}
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
            captureBusy={captureExport.captureBusy}
            onShowInFolder={() => { void window.electronAPI.showInFolder(selectedFile.path); }}
          />
        )}

        <Box ref={contentAreaRef} flex={1} style={{ overflowY: 'auto' }}>
          {fileContent && parsedBlocks ? (
            <MarkdownView content={fileContent} blocks={parsedBlocks} headerAction={rewriteHeaderAction} />
          ) : selectedFile ? (
            <Flex align="center" justify="center" h="100%" c="dimmed" fz="var(--font-size-md)">
              {t('main.loading')}
            </Flex>
          ) : tempChatMode && tempChatContent && tempChatBlocks ? (
            <MarkdownView content={tempChatContent} blocks={tempChatBlocks} />
          ) : tempChatMode ? (
            <IncognitoWelcome />
          ) : (
            <WelcomeScreen activeModelUrl={activeModelUrl} />
          )}
        </Box>

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
          onRunCommand={(command, input) => { void runCommand(command, input); }}
          onUnknownCommand={handleUnknownCommand}
        />
      </Stack>
      </ChatDropZone>

      <LoginRequiredDialog
        provider={pendingLoginModel?.provider ?? null}
        t={t}
        onCancel={() => setPendingLoginModel(null)}
        onConfirm={handleLoginConfirm}
      />

      <ExportDialog
        open={captureExport.captureDialogOpen}
        background={captureExport.captureBackground}
        cardTheme={captureExport.captureCardTheme}
        palettes={CAPTURE_PALETTES}
        selectedPalette={captureExport.capturePaletteKey}
        setSelectedPalette={captureExport.setCapturePaletteKey}
        direction={captureExport.captureDirection}
        setDirection={(value) => captureExport.setCaptureDirection(value as CaptureDirection)}
        showPrompt={captureExport.captureShowPrompt}
        setShowPrompt={captureExport.setCaptureShowPrompt}
        showProvider={captureExport.captureShowProvider}
        setShowProvider={captureExport.setCaptureShowProvider}
        showTimestamp={captureExport.captureShowTimestamp}
        setShowTimestamp={captureExport.setCaptureShowTimestamp}
        title={captureExport.captureTitle}
        setTitle={captureExport.setCaptureTitle}
        fileName={captureExport.captureFileName}
        setFileName={captureExport.setCaptureFileName}
        format={captureExport.captureFormat}
        setFormat={captureExport.setCaptureFormat}
        preview={captureExport.capturePreview}
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

      {runningCommand && (
        <Group
          gap={8}
          pos="fixed"
          right={14}
          bottom={14}
          miw={200}
          bg="var(--mantine-color-default)"
          p="8px 12px"
          wrap="nowrap"
          style={{
            zIndex: 130,
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-sm)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Loader size="xs" />
          <Text fz="var(--font-size-base)" c="var(--mantine-color-text)">
            {t('chat.slash.running').replace('{{command}}', runningCommand)}
          </Text>
        </Group>
      )}
    </Flex>
  );
});

