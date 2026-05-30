import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Button, Flex, Group, Stack, Text } from '@mantine/core';
import { RefreshCw, X } from 'lucide-react';
import type { CaptureFormat } from '../../../shared/types';
import { Sidebar } from '../components/Sidebar';
import { MarkdownView } from '../components/MarkdownView';
import { ExportDialog } from '../components/ExportDialog';
import { FileHeaderBar } from '../components/chat/FileHeaderBar';
import { ModelDropdown } from '../components/chat/ModelDropdown';
import { PromptInputArea, type PromptInputAreaHandle } from '../components/chat/PromptInputArea';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { findModelOption } from '../config/models';
import { useGlobalHotkeys } from '../hooks/useGlobalHotkeys';
import {
  useCaptureExport,
  CAPTURE_PALETTES,
  type ExportToast,
  type CaptureDirection,
} from '../hooks/useCaptureExport';
import { useRewriteTask } from '../hooks/useRewriteTask';
import { fileApi, settingsApi, clipboardApi, promptApi } from '../api/electronApi';
import styles from './ChatView.module.css';

const RewriteTriggerButton = React.memo<{
  onStart: (url: string) => void;
  title: string;
}>(({ onStart, title }) => (
  <ModelDropdown
    value=""
    onChange={onStart}
    menuDirection="down"
    renderTrigger={({ toggle, open }) => (
      <ActionIcon
        onClick={toggle}
        title={title}
        variant="transparent"
        size="sm"
        opacity={open ? 1 : 0.7}
      >
        <RefreshCw size={16} />
      </ActionIcon>
    )}
  />
));

export const ChatView: React.FC = () => {
  const {
    selectedFile,
    fileContent,
    parsedBlocks,
    setFileContent,
    setFiles,
    selectFile,
    layoutMode,
    setLayoutMode,
    markdownZoom,
    zoomInMarkdown,
    zoomOutMarkdown,
    resetMarkdownZoom,
    setAiUrl,
  } = useAppStore();
  const { t, locale } = useI18nStore();

  const [activeModelUrl, setActiveModelUrl] = useState(() => useAppStore.getState().aiUrl);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [exportToast, setExportToast] = useState<ExportToast>(null);
  const [headerEditing, setHeaderEditing] = useState(false);
  const [headerEditValue, setHeaderEditValue] = useState('');

  // hooks extracted from ChatView
  const captureExport = useCaptureExport(setExportToast);
  const { startRewrite } = useRewriteTask(setExportToast);

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


  // auto-dismiss export toast after 4.5s
  useEffect(() => {
    if (!exportToast) return;
    const timer = window.setTimeout(() => setExportToast((cur) => (
      cur?.id === exportToast.id ? null : cur
    )), 4_500);
    return () => window.clearTimeout(timer);
  }, [exportToast]);

  // clear toast on file switch
  useEffect(() => {
    setExportToast(null);
  }, [selectedFile?.path]);

  useEffect(() => {
    if (headerEditing) {
      window.requestAnimationFrame(() => headerInputRef.current?.select());
    }
  }, [headerEditing]);

  const handleSendPrompt = useCallback(async (text: string): Promise<void> => {
    // Persist the selected provider and navigate the worker window only on send,
    // not when the user just opens the dropdown and picks a model.
    const currentModelUrl = useAppStore.getState().aiUrl;
    if (activeModelUrl !== currentModelUrl) {
      await settingsApi.updateAiUrl(activeModelUrl);
      setAiUrl(activeModelUrl);
    }
    promptApi.triggerWithOptions({ prompt: text, targetUrl: activeModelUrl });
  }, [activeModelUrl, setAiUrl]);

  const handleAiUrlChange = useCallback((nextUrl: string): void => {
    // Only update local UI state; do NOT navigate or persist yet.
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
        />
      </Stack>

      <ExportDialog
        open={captureExport.captureDialogOpen}
        background={captureExport.captureBackground}
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
    </Flex>
  );
};

const WelcomeStepCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box className={styles.stepCard}>{children}</Box>
);

const WelcomeScreen: React.FC<{ activeModelUrl: string }> = ({ activeModelUrl }) => {
  const { hotkey, duckaiModels } = useAppStore();
  const { t } = useI18nStore();
  const providerLabel = findModelOption(activeModelUrl, duckaiModels).label;
  const welcomeHint = t('welcome.hint').replace('{{provider}}', providerLabel);

  return (
    <Stack align="center" justify="center" gap={18} h="100%" c="dimmed" p="24px 20px">
      <Text fw={700} fz="var(--font-size-3xl)" lts="-0.01em" c="var(--mantine-color-text)">
        Desktop Agent Center
      </Text>
      <Text fz="var(--font-size-base)" maw={340} ta="center" lh={1.75} c="dimmed">
        {welcomeHint}
      </Text>
      <Stack gap={6} w="min(420px, 92%)">
        {[
          t('welcome.step.copy'),
          t('welcome.step.hotkey').replace('{{hotkey}}', hotkey),
          t('welcome.step.review'),
        ].map((step) => (
          <WelcomeStepCard key={step}>{step}</WelcomeStepCard>
        ))}
      </Stack>
    </Stack>
  );
};


