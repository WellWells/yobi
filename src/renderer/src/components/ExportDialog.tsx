import React, { useMemo, useState } from 'react';
import { Modal, Button, Box, Flex, Group, Text, Tooltip } from '@mantine/core';
import 'katex/dist/katex.min.css';
import type { CaptureFormat, CaptureRange, CardLayout, MarkdownCaptureRequest } from '../../../shared/types';
import { Clipboard, Download, Image as ImageIcon, ImageDown, Save } from 'lucide-react';
import { ExportSettingsPanel } from './exportDialog/ExportSettingsPanel';
import { ExportPreviewPanel } from './exportDialog/ExportPreviewPanel';
import { AppButton } from './AppButton';
import { captureBackgroundCss, paletteCardTheme } from '../../../shared/capturePalettes';
import type {
  CaptureBackgroundStyle,
  CaptureDirection,
  CapturePalette,
} from '../../../shared/capturePalettes';

interface ExportDialogProps {
  open: boolean;
  palettes: readonly CapturePalette[];
  selectedPalette: string;
  setSelectedPalette: (value: string) => void;
  backgroundStyle: CaptureBackgroundStyle;
  setBackgroundStyle: (value: CaptureBackgroundStyle) => void;
  direction: string;
  setDirection: (value: string) => void;
  showPrompt: boolean;
  setShowPrompt: (value: boolean) => void;
  showProvider: boolean;
  setShowProvider: (value: boolean) => void;
  showTimestamp: boolean;
  setShowTimestamp: (value: boolean) => void;
  showTokens: boolean;
  setShowTokens: (value: boolean) => void;
  title: string;
  setTitle: (value: string) => void;
  fileName: string;
  setFileName: (value: string) => void;
  format: CaptureFormat;
  setFormat: (value: CaptureFormat) => void;
  cardLayout: CardLayout;
  setCardLayout: (value: CardLayout) => void;
  range: CaptureRange;
  setRange: (value: CaptureRange) => void;
  turnCount: number;
  width: number;
  setWidth: (value: number) => void;
  margin: number;
  setMargin: (value: number) => void;
  hiDpi: boolean;
  setHiDpi: (value: boolean) => void;
  zip: boolean;
  setZip: (value: boolean) => void;
  request: MarkdownCaptureRequest | null;
  t: (key: string) => string;
  busy: boolean;
  busyMode: 'copy' | 'save' | null;
  onCopy: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  palettes,
  selectedPalette,
  setSelectedPalette,
  backgroundStyle,
  setBackgroundStyle,
  direction,
  setDirection,
  showPrompt,
  setShowPrompt,
  showProvider,
  setShowProvider,
  showTimestamp,
  setShowTimestamp,
  showTokens,
  setShowTokens,
  title,
  setTitle,
  fileName,
  setFileName,
  format,
  setFormat,
  cardLayout,
  setCardLayout,
  range,
  setRange,
  turnCount,
  width,
  setWidth,
  margin,
  setMargin,
  hiDpi,
  setHiDpi,
  zip,
  setZip,
  request,
  t,
  busy,
  busyMode,
  onCopy,
  onSave,
  onCancel,
}) => {
  const [hoveredPalette, setHoveredPalette] = useState<string | null>(null);
  const previewRequest = useMemo(() => {
    if (!request) return null;
    const hovered = hoveredPalette ? palettes.find((p) => p.key === hoveredPalette) : undefined;
    if (!hovered) return request;
    return {
      ...request,
      options: {
        ...request.options,
        background: captureBackgroundCss(hovered.key, backgroundStyle, direction as CaptureDirection),
        cardTheme: paletteCardTheme(hovered.key),
      },
    };
  }, [request, hoveredPalette, palettes, backgroundStyle, direction]);

  const isPdf = format === 'pdf';
  const saveLabel = isPdf
    ? t('capture.savePdf')
    : t('capture.saveImage');

  return (
    <Modal
      opened={open}
      onClose={onCancel}
      title={
        <Group gap={8}>
          <Box c="var(--accent)"><ImageDown size={16} /></Box>
          <Text component="span" fz="var(--font-size-xl)" fw={700} c="var(--text-primary)">
            {t('capture.dialog.title')}
          </Text>
        </Group>
      }
      size="xl"
      centered
      zIndex={80}
      styles={{
        content: {
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(680px, 85vh)',
        },
        header: {
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
        },
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >

      <Flex flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
        <ExportSettingsPanel
          palettes={palettes}
          backgroundStyle={backgroundStyle}
          setBackgroundStyle={setBackgroundStyle}
          selectedPalette={selectedPalette}
          setSelectedPalette={setSelectedPalette}
          direction={direction}
          setDirection={setDirection}
          showPrompt={showPrompt}
          setShowPrompt={setShowPrompt}
          showProvider={showProvider}
          setShowProvider={setShowProvider}
          showTimestamp={showTimestamp}
          setShowTimestamp={setShowTimestamp}
          showTokens={showTokens}
          setShowTokens={setShowTokens}
          title={title}
          setTitle={setTitle}
          fileName={fileName}
          setFileName={setFileName}
          format={format}
          setFormat={setFormat}
          cardLayout={cardLayout}
          setCardLayout={setCardLayout}
          range={range}
          setRange={setRange}
          turnCount={turnCount}
          width={width}
          setWidth={setWidth}
          margin={margin}
          setMargin={setMargin}
          hiDpi={hiDpi}
          setHiDpi={setHiDpi}
          zip={zip}
          setZip={setZip}
          onHoverPalette={setHoveredPalette}
          t={t}
        />

        <ExportPreviewPanel request={previewRequest} t={t} />
      </Flex>

      <Group
        justify="flex-end"
        gap={8}
        p="12px 16px"
        bg="var(--bg-secondary)"
        style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}
      >
        <Button variant="subtle" onClick={onCancel}>
          {t('dialog.cancel')}
        </Button>
        {
}
        <Tooltip label={t('capture.copy.pdf.hint')} position="top" disabled={!isPdf} maw={300} multiline>
          <AppButton
            variant="outline"
            onClick={onCopy}
            disabled={busy}
            loading={busyMode === 'copy'}
            justify="center"
            leftSection={isPdf ? <Clipboard size={14} /> : <ImageIcon size={14} />}
          >
            {busyMode === 'copy' ? t('capture.copying') : t('capture.copy')}
          </AppButton>
        </Tooltip>
        <AppButton
          variant="filled"
          onClick={onSave}
          disabled={busy}
          loading={busyMode === 'save'}
          justify="center"
          leftSection={isPdf ? <Save size={14} /> : <Download size={14} />}
        >
          {busyMode === 'save' ? t('capture.exporting') : saveLabel}
        </AppButton>
      </Group>
    </Modal>
  );
};
