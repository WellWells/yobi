import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { systemApi } from '../api/electronApi';
import { useExportSettingsStore } from '../store/exportSettingsStore';
import { formatCardTime } from '../../../shared/captureCard';
import {
  CAPTURE_PALETTES,
  captureBackgroundCss,
  type CaptureBackgroundStyle,
  type CaptureDirection,
} from './captureTheme';
import { buildTurnCaptureRequest } from './captureRequest';
import type { CaptureLook } from './captureRequest';
import { captureLookFrom, captureTurnsFor, conversationCaptureRequest } from './conversationCapture';
import type { NoticeLevel } from './useUiNotifications';
import type {
  CaptureFormat,
  CaptureTurn,
  CaptureRange,
  CardLayout,
  MarkdownCaptureRequest,
} from '../../../shared/types';
import { DEFAULT_CAPTURE_WIDTH, clampCaptureMargin } from '../../../shared/types';

export { CAPTURE_PALETTES, captureBackgroundCss, formatCardTime };
export type { CaptureBackgroundStyle, CaptureDirection };

/**
 * A notice raised from inside the window; the surface colours it by `level`. `null` retracts
 * whatever this window has up.
 */
export type ExportToast = {
  message: string;
  level?: NoticeLevel;
  filePath?: string;
  fileName?: string;
} | null;

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

  const captureLook = useMemo<CaptureLook>(() => captureLookFrom(capture), [capture]);
  const captureBackground = captureLook.background;
  const captureCardTheme = captureLook.cardTheme;

  const captureTurns = useMemo<CaptureTurn[]>(
    () => captureTurnsFor(conversation, parsedBlocks, locale, t),
    [conversation, parsedBlocks, locale, t],
  );

  const captureRequest = useMemo<MarkdownCaptureRequest | null>(() => {
    if (!fileContent || !selectedFile || !parsedBlocks) return null;
    const title = captureTitle.trim() || parsedBlocks.title
      || selectedFile.name.replace(/\.md$/i, '') || t('capture.noTitle');
    return conversationCaptureRequest(
      { content: fileContent, blocks: parsedBlocks, conversation, title, fileName: captureFileName.trim() },
      {
        look: captureLook, format: captureFormat, range: captureRange, showPrompt: captureShowPrompt, locale, t,
      },
    );
  }, [
    fileContent, selectedFile, parsedBlocks, captureTitle, captureRange, captureFormat, t, conversation,
    captureShowPrompt, captureFileName, locale, captureLook,
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
          message: result.error ? `${t('capture.failed')}: ${result.error}` : t('capture.failed'),
          level: 'error',
        });
        return;
      }
      if (mode === 'copy') {
        setExportToast({ message: t('capture.copied') });
        return;
      }
      if (!result.filePath) {
        setExportToast({ message: t('capture.failed'), level: 'error' });
        return;
      }
      const fileName = result.filePath.split(/[\\/]/).pop() || result.filePath;
      setExportToast({ message: t('capture.savedPrefix'), filePath: result.filePath, fileName });
      setCaptureDialogOpen(false);
    } catch {
      setExportToast({ message: t('capture.failed'), level: 'error' });
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
        message: result.error ? `${t('capture.failed')}: ${result.error}` : t('capture.failed'),
        level: 'error',
      });
      return false;
    } catch {
      setExportToast({ message: t('capture.failed'), level: 'error' });
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
