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
import { ChatDropZone } from '../components/chat/ChatDropZone';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
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
import { fileApi, settingsApi, clipboardApi, promptApi } from '../api/electronApi';

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
  const { selectedFile, fileContent, parsedBlocks, layoutMode, markdownZoom } = useAppStore(
    useShallow((s) => ({
      selectedFile: s.selectedFile,
      fileContent: s.fileContent,
      parsedBlocks: s.parsedBlocks,
      layoutMode: s.layoutMode,
      markdownZoom: s.markdownZoom,
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

  useGlobalHotkeys({
    contentAreaRef,
    onFocusPrompt: focusPromptInput,
    zoomInMarkdown,
    zoomOutMarkdown,
    resetMarkdownZoom,
  });

  useEffect(() => {
    setViewMenuOpen(false);
  }, [selectedFile?.path]);


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

  const handleSendPrompt = useCallback(async (text: string): Promise<void> => {
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
  }, [activeModelUrl, attachments, clearAttachments, setAiUrl]);

  const handleAiUrlChange = useCallback((nextUrl: string): void => {
    setActiveModelUrl(nextUrl);
  }, []);

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
      <Stack gap={0} flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
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
          ) : (
            <WelcomeScreen activeModelUrl={activeModelUrl} />
          )}
        </Box>

        <PromptInputArea
          ref={promptAreaRef}
          t={t}
          activeModelUrl={activeModelUrl}
          onChangeModel={handleAiUrlChange}
          onSend={(text) => { void handleSendPrompt(text); }}
          attachments={attachments}
          notice={attachmentNotice}
          onRemoveAttachment={removeAttachment}
          chatCommands={chatCommands}
          onRunCommand={(command, input) => { void runCommand(command, input); }}
          onUnknownCommand={handleUnknownCommand}
        />
      </Stack>
      </ChatDropZone>

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

