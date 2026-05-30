// src/renderer/src/hooks/useCaptureExport.ts
// Extracted from ChatView to reduce complexity.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { settingsApi, systemApi } from '../api/electronApi';
import { getResponseAliases } from '../utils/parseMarkdownBlocks';
import type { CaptureFormat, CaptureSettings, MarkdownCapturePayload } from '../../../shared/types';

// ── Shared types (also imported by ChatView) ──────────────────────────────────
export type ExportToast = {
  id: number;
  message: string;
  filePath?: string;
  fileName?: string;
} | null;

// ── Constants (moved out of ChatView) ──────────────────────────────────────────────
export const CAPTURE_PALETTES = [
  { key: 'aurora', label: 'Aurora', from: '#0f172a', to: '#3b0764' },
  { key: 'mint',   label: 'Mint',   from: '#0f766e', to: '#1f2937' },
  { key: 'rose',   label: 'Rose',   from: '#7f1d1d', to: '#312e81' },
  { key: 'ocean',  label: 'Ocean',  from: '#0c4a6e', to: '#1e293b' },
  { key: 'sunset', label: 'Sunset', from: '#7c2d12', to: '#4338ca' },
  { key: 'forest', label: 'Forest', from: '#14532d', to: '#1f2937' },
  { key: 'violet', label: 'Violet', from: '#312e81', to: '#4a044e' },
  { key: 'steel',  label: 'Steel',  from: '#334155', to: '#111827' },
  { key: 'ember',  label: 'Ember',  from: '#7f1d1d', to: '#111827' },
] as const;

export type CaptureDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'c';

// ── Pure functions (moved out of ChatView) ──────────────────────────────────────────
export function buildCaptureBackground(from: string, to: string, direction: CaptureDirection): string {
  if (direction === 'c') return `radial-gradient(circle at center, ${from} 0%, ${to} 100%)`;
  const angleMap: Record<Exclude<CaptureDirection, 'c'>, number> = {
    n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
  };
  return `linear-gradient(${angleMap[direction]}deg, ${from} 0%, ${to} 100%)`;
}

function stripAfterResponseHeading(raw: string): string {
  const lines = raw.split('\n');
  const responseAliases = getResponseAliases();
  // Uses i18n-derived response heading aliases as the single source of truth.
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

// ── Hook ──────────────────────────────────────────────────────────────────
export function useCaptureExport(setExportToast: (toast: ExportToast) => void) {
  const { fileContent, selectedFile, parsedBlocks } = useAppStore();
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

  // ── Load settings from config on mount ───────────────────────────────────
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

  // ── Persist settings to config whenever they change ──────────────────────
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
  }, [capturePreview, captureFormat, captureShowPrompt, captureShowProvider, captureShowTimestamp, captureFileName, captureBackground, t, setExportToast]);

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
    captureBackground, capturePreview,
    handleCaptureImage,
  };
}
