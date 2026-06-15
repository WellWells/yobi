import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { settingsApi, systemApi } from '../api/electronApi';
import { getResponseAliases } from '../utils/parseMarkdownBlocks';
import {
  CAPTURE_PALETTES,
  buildCaptureBackground,
  paletteCardTheme,
  type CaptureDirection,
} from './captureTheme';
import type { CaptureFormat, CaptureSettings, MarkdownCapturePayload } from '../../../shared/types';

export { CAPTURE_PALETTES, buildCaptureBackground };
export type { CaptureDirection };

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
  const { fileContent, selectedFile, parsedBlocks } = useAppStore(
    useShallow((s) => ({
      fileContent: s.fileContent,
      selectedFile: s.selectedFile,
      parsedBlocks: s.parsedBlocks,
    })),
  );
  const { t } = useI18nStore();

  const [captureDialogOpen, setCaptureDialogOpen] = useState(false);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>('png');
  const [capturePaletteKey, setCapturePaletteKey] = useState<string>(CAPTURE_PALETTES[0].key);
  const [captureDirection, setCaptureDirection] = useState<CaptureDirection>('se');
  const [captureShowPrompt, setCaptureShowPrompt] = useState(false);
  const [captureShowProvider, setCaptureShowProvider] = useState(true);
  const [captureShowTimestamp, setCaptureShowTimestamp] = useState(true);
  const [captureTitle, setCaptureTitle] = useState('');
  const [captureFileName, setCaptureFileName] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureBusyMode, setCaptureBusyMode] = useState<'copy' | 'save' | null>(null);

  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    settingsApi.getCaptureSettings().then((s: CaptureSettings) => {
      settingsLoadedRef.current = true;
      setCaptureFormat(s.format);
      setCapturePaletteKey(s.palette);
      setCaptureDirection(s.direction as CaptureDirection);
      setCaptureShowPrompt(Boolean(s.showPrompt));
      setCaptureShowProvider(s.showProvider);
      setCaptureShowTimestamp(s.showTimestamp);
    }).catch(() => { settingsLoadedRef.current = true; });
  }, []);

  useEffect(() => {
    if (!selectedFile || !parsedBlocks) return;
    const defaultTitle = parsedBlocks.title || selectedFile.name.replace(/\.md$/i, '');
    const defaultFileName = selectedFile.name.replace(/\.md$/i, '');
    setCaptureTitle(defaultTitle);
    setCaptureFileName(defaultFileName);
  }, [selectedFile?.path, selectedFile?.name, parsedBlocks?.title, parsedBlocks?.provider, parsedBlocks?.time]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    void settingsApi.updateCaptureSettings({
      format: captureFormat,
      palette: capturePaletteKey,
      direction: captureDirection,
      showPrompt: captureShowPrompt,
      showProvider: captureShowProvider,
      showTimestamp: captureShowTimestamp,
    });
  }, [captureFormat, capturePaletteKey, captureDirection, captureShowPrompt, captureShowProvider, captureShowTimestamp]);

  const captureBackground = useMemo(() => {
    const palette = CAPTURE_PALETTES.find((p) => p.key === capturePaletteKey) ?? CAPTURE_PALETTES[0];
    return buildCaptureBackground(palette.from, palette.to, captureDirection);
  }, [capturePaletteKey, captureDirection]);

  const captureCardTheme = useMemo(() => paletteCardTheme(capturePaletteKey), [capturePaletteKey]);

  const capturePreview = useMemo<MarkdownCapturePayload | null>(() => {
    if (!fileContent || !selectedFile || !parsedBlocks) return null;
    const title = captureTitle.trim() || parsedBlocks.title || selectedFile.name.replace(/\.md$/i, '');
    const contentToCapture = parsedBlocks.response || fileContent;
    const preResponse = stripAfterResponseHeading(fileContent);
    return {
      title,
      prompt: parsedBlocks.prompt || '',
      content: contentToCapture,
      summary: buildSummary(preResponse || contentToCapture),
      provider: parsedBlocks.provider || '',
      timestamp: parsedBlocks.time || '',
    };
  }, [fileContent, selectedFile, parsedBlocks, captureTitle]);

  const handleCaptureImage = useCallback(async (mode: 'save' | 'copy') => {
    if (!capturePreview) return;
    setCaptureBusy(true);
    setCaptureBusyMode(mode);
    setExportToast(null);
    try {
      const result = await systemApi.captureMarkdownDocument({
        payload: capturePreview,
        options: {
          mode,
          format: captureFormat,
          showPrompt: captureShowPrompt,
          showContent: true,
          showProvider: captureShowProvider,
          showTimestamp: captureShowTimestamp,
          fileName: captureFileName.trim(),
          width: 1200,
          background: captureBackground,
          cardTheme: captureCardTheme,
        },
      });
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
  }, [capturePreview, captureFormat, captureShowPrompt, captureShowProvider, captureShowTimestamp, captureFileName, captureBackground, captureCardTheme, t, setExportToast]);

  return {
    captureDialogOpen, setCaptureDialogOpen,
    captureFormat, setCaptureFormat,
    capturePaletteKey, setCapturePaletteKey,
    captureDirection, setCaptureDirection,
    captureShowPrompt, setCaptureShowPrompt,
    captureShowProvider, setCaptureShowProvider,
    captureShowTimestamp, setCaptureShowTimestamp,
    captureTitle, setCaptureTitle,
    captureFileName, setCaptureFileName,
    captureBusy, captureBusyMode,
    captureBackground, captureCardTheme, capturePreview,
    handleCaptureImage,
  };
}
