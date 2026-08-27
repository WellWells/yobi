import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { systemApi } from '../api/electronApi';
import { useExportSettingsStore } from '../store/exportSettingsStore';
import { getResponseAliases } from '../utils/parseMarkdownBlocks';
import { stripConversationMarkers } from '../../../shared/conversationDoc';
import { totalTokenLabel, turnTokenLabel } from '../utils/captureTokens';
import {
  CAPTURE_PALETTES,
  captureBackgroundCss,
  paletteCardTheme,
  type CaptureBackgroundStyle,
  type CaptureDirection,
} from './captureTheme';
import { buildCaptureRequest, buildTurnCaptureRequest } from './captureRequest';
import type { CaptureLook } from './captureRequest';
import type {
  CaptureFormat,
  CaptureTurn,
  CaptureRange,
  CardLayout,
  MarkdownCaptureRequest,
} from '../../../shared/types';
import { DEFAULT_CAPTURE_WIDTH, clampCaptureMargin } from '../../../shared/types';

export { CAPTURE_PALETTES, captureBackgroundCss };
export type { CaptureBackgroundStyle, CaptureDirection };

export type ExportToast = {
  id: number;
  message: string;
  filePath?: string;
  fileName?: string;
} | null;

function stripAfterResponseHeading(raw: string): string {
  const lines = raw.split('\n');
  const responseAliases = getResponseAliases();
  const responseIdx = lines.findIndex((line) => {
    const m = line.trim().match(/^##\s+(.+)$/);
    return m != null && responseAliases.has(m[1].trim());
  });
  if (responseIdx < 0) return raw;
  return lines.slice(0, responseIdx).join('\n').trim();
}

export function formatCardTime(ts: string, locale: string): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function buildSummary(raw: string): string {
  const plain = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
}

export function useCaptureExport(setExportToast: (toast: ExportToast) => void) {
  const { fileContent, selectedFile, parsedBlocks, conversation } = useAppStore(
    useShallow((s) => ({
      fileContent: s.fileContent,
      selectedFile: s.selectedFile,
      parsedBlocks: s.parsedBlocks,
      conversation: s.conversation,
    })),
  );
  const { t, locale } = useI18nStore();

  const capture = useExportSettingsStore((s) => s.capture);
  const patchCapture = useExportSettingsStore((s) => s.patchCapture);
  const loadExportSettings = useExportSettingsStore((s) => s.load);

  const [captureDialogOpen, setCaptureDialogOpen] = useState(false);
  const [captureTitle, setCaptureTitle] = useState('');
  const [captureFileName, setCaptureFileName] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureBusyMode, setCaptureBusyMode] = useState<'copy' | 'save' | null>(null);

  useEffect(() => { void loadExportSettings(); }, [loadExportSettings]);

  useEffect(() => {
    if (!selectedFile || !parsedBlocks) return;
    const defaultTitle = parsedBlocks.title || selectedFile.name.replace(/\.md$/i, '');
    const defaultFileName = selectedFile.name.replace(/\.md$/i, '');
    setCaptureTitle(defaultTitle);
    setCaptureFileName(defaultFileName);
  }, [selectedFile?.path, selectedFile?.name, parsedBlocks?.title, parsedBlocks?.provider, parsedBlocks?.time]);

  const captureFormat = capture.format;
  const capturePaletteKey = capture.palette;
  const captureBackgroundStyle = capture.backgroundStyle as CaptureBackgroundStyle;
  const captureDirection = capture.direction as CaptureDirection;
  const captureShowPrompt = capture.showPrompt;
  const captureCardLayout = capture.cardLayout;
  const captureRange = capture.range;
  const captureWidth = capture.width || DEFAULT_CAPTURE_WIDTH;
  const captureMargin = clampCaptureMargin(capture.margin);
  const captureHiDpi = capture.pixelRatio === 2;
  const captureZip = capture.zip;
  const captureShowProvider = capture.showProvider;
  const captureShowTimestamp = capture.showTimestamp;
  const captureShowTokens = capture.showTokens;

  const setCaptureFormat = useCallback((v: CaptureFormat) => patchCapture({ format: v }), [patchCapture]);
  const setCapturePaletteKey = useCallback((v: string) => patchCapture({ palette: v }), [patchCapture]);
  const setCaptureDirection = useCallback((v: CaptureDirection) => patchCapture({ direction: v }), [patchCapture]);
  const setCaptureBackgroundStyle = useCallback(
    (v: CaptureBackgroundStyle) => patchCapture({ backgroundStyle: v }),
    [patchCapture],
  );
  const setCaptureShowPrompt = useCallback((v: boolean) => patchCapture({ showPrompt: v }), [patchCapture]);
  const setCaptureCardLayout = useCallback((v: CardLayout) => patchCapture({ cardLayout: v }), [patchCapture]);
  const setCaptureRange = useCallback((v: CaptureRange) => patchCapture({ range: v }), [patchCapture]);
  const setCaptureWidth = useCallback((v: number) => patchCapture({ width: v }), [patchCapture]);
  const setCaptureMargin = useCallback((v: number) => patchCapture({ margin: v }), [patchCapture]);
  const setCaptureHiDpi = useCallback((v: boolean) => patchCapture({ pixelRatio: v ? 2 : 1 }), [patchCapture]);
  const setCaptureZip = useCallback((v: boolean) => patchCapture({ zip: v }), [patchCapture]);
  const setCaptureShowProvider = useCallback((v: boolean) => patchCapture({ showProvider: v }), [patchCapture]);
  const setCaptureShowTimestamp = useCallback((v: boolean) => patchCapture({ showTimestamp: v }), [patchCapture]);
  const setCaptureShowTokens = useCallback((v: boolean) => patchCapture({ showTokens: v }), [patchCapture]);

  const captureBackground = useMemo(
    () => captureBackgroundCss(capturePaletteKey, captureBackgroundStyle, captureDirection),
    [capturePaletteKey, captureBackgroundStyle, captureDirection],
  );

  const captureCardTheme = useMemo(() => paletteCardTheme(capturePaletteKey), [capturePaletteKey]);

  const docTime = useMemo(
    () => formatCardTime(parsedBlocks?.time || '', locale),
    [parsedBlocks?.time, locale],
  );

  const captureTurns = useMemo<CaptureTurn[]>(() => {
    const docProvider = parsedBlocks?.provider || '';
    if (conversation && conversation.turns.length > 0) {
      return conversation.turns.map((turn) => ({
        prompt: turn.prompt,
        response: turn.response,
        provider: turn.meta.p || docProvider,
        timestamp: formatCardTime(turn.meta.t ?? '', locale) || docTime,
        tokens: turnTokenLabel(turn.meta, t),
      }));
    }
    if (!parsedBlocks?.prompt && !parsedBlocks?.response) return [];
    return [{
      prompt: parsedBlocks.prompt || '',
      response: parsedBlocks.response || '',
      provider: docProvider,
      timestamp: docTime,
    }];
  }, [conversation, parsedBlocks, docTime, locale]);

  const captureLook = useMemo<CaptureLook>(() => ({
    background: captureBackground,
    cardTheme: captureCardTheme,
    cardLayout: captureCardLayout,
    width: captureWidth,
    margin: captureMargin,
    pixelRatio: captureHiDpi ? 2 : 1,
    zip: captureZip,
    showProvider: captureShowProvider,
    showTimestamp: captureShowTimestamp,
    showTokens: captureShowTokens,
  }), [
    captureBackground, captureCardTheme, captureCardLayout, captureWidth, captureMargin, captureHiDpi, captureZip,
    captureShowProvider, captureShowTimestamp, captureShowTokens,
  ]);

  const captureRequest = useMemo<MarkdownCaptureRequest | null>(() => {
    if (!fileContent || !selectedFile || !parsedBlocks) return null;
    const title = captureTitle.trim() || parsedBlocks.title
      || selectedFile.name.replace(/\.md$/i, '') || t('capture.noTitle');
    const cleanFile = stripConversationMarkers(fileContent);
    const contentToCapture = stripConversationMarkers(parsedBlocks.response || fileContent);
    const preResponse = stripAfterResponseHeading(cleanFile);
    return buildCaptureRequest({
      ...captureLook,
      title,
      fileName: captureFileName.trim(),
      format: captureFormat,
      range: captureRange,
      showPrompt: captureShowPrompt,
      prompt: stripConversationMarkers(parsedBlocks.prompt || ''),
      content: contentToCapture,
      summary: buildSummary(preResponse || contentToCapture),
      provider: parsedBlocks.provider || '',
      timestamp: docTime,
      turns: captureTurns,
      tokensTotal: totalTokenLabel(
        captureRange === 'last' ? (conversation?.turns ?? []).slice(-1) : (conversation?.turns ?? []),
        t,
      ),
    });
  }, [
    fileContent, selectedFile, parsedBlocks, captureTitle, captureTurns, captureRange, captureFormat, t, conversation,
    captureShowPrompt, captureFileName, docTime, captureLook,
  ]);

  const handleCaptureImage = useCallback(async (mode: 'save' | 'copy') => {
    if (!captureRequest) return;
    setCaptureBusy(true);
    setCaptureBusyMode(mode);
    setExportToast(null);
    try {
      const result = await systemApi.captureMarkdownDocument({
        ...captureRequest,
        options: { ...captureRequest.options, mode },
      });
      if (result.canceled) return;
      if (!result.ok) {
        setExportToast({
          id: Date.now(),
          message: result.error ? `${t('capture.failed')}: ${result.error}` : t('capture.failed'),
        });
        return;
      }
      if (mode === 'copy') {
        setExportToast({ id: Date.now(), message: t('capture.copied') });
        return;
      }
      if (!result.filePath) {
        setExportToast({ id: Date.now(), message: t('capture.failed') });
        return;
      }
      const fileName = result.filePath.split(/[\\/]/).pop() || result.filePath;
      setExportToast({ id: Date.now(), message: t('capture.savedPrefix'), filePath: result.filePath, fileName });
      setCaptureDialogOpen(false);
    } catch {
      setExportToast({ id: Date.now(), message: t('capture.failed') });
    } finally {
      setCaptureBusy(false);
      setCaptureBusyMode(null);
    }
  }, [captureRequest, t, setExportToast]);

  const captureTurnAs = useCallback(async (
    format: CaptureFormat,
    turn: CaptureTurn,
    zip: boolean,
  ): Promise<boolean> => {
    const title = captureTitle.trim() || parsedBlocks?.title
      || selectedFile?.name.replace(/\.md$/i, '') || '';
    try {
      const result = await systemApi.captureMarkdownDocument(buildTurnCaptureRequest({
        ...captureLook,
        zip,
        title,
        fileName: captureFileName.trim(),
        format,
        turn,
      }));
      if (result.ok) return true;
      setExportToast({
        id: Date.now(),
        message: result.error ? `${t('capture.failed')}: ${result.error}` : t('capture.failed'),
      });
      return false;
    } catch {
      setExportToast({ id: Date.now(), message: t('capture.failed') });
      return false;
    }
  }, [captureLook, captureTitle, captureFileName, parsedBlocks?.title, selectedFile?.name, t, setExportToast]);

  return {
    captureDialogOpen, setCaptureDialogOpen,
    captureFormat, setCaptureFormat,
    capturePaletteKey, setCapturePaletteKey,
    captureBackgroundStyle, setCaptureBackgroundStyle,
    captureDirection, setCaptureDirection,
    captureShowPrompt, setCaptureShowPrompt,
    captureCardLayout, setCaptureCardLayout,
    captureRange, setCaptureRange,
    captureTurnCount: captureTurns.length,
    captureWidth, setCaptureWidth,
    captureMargin, setCaptureMargin,
    captureHiDpi, setCaptureHiDpi,
    captureZip, setCaptureZip,
    captureShowProvider, setCaptureShowProvider,
    captureShowTimestamp, setCaptureShowTimestamp,
    captureShowTokens, setCaptureShowTokens,
    captureTitle, setCaptureTitle,
    captureFileName, setCaptureFileName,
    captureBusy, captureBusyMode,
    captureBackground, captureCardTheme, captureRequest,
    handleCaptureImage, captureTurnAs,
  };
}
