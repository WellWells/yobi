import React from 'react';
import { Modal, Button, Box, Flex, Group, Text } from '@mantine/core';
import 'katex/dist/katex.min.css';
import type { CaptureFormat, CardTheme, MarkdownCapturePayload } from '../../../shared/types';
import { Clipboard, Download, Image as ImageIcon, Save, Upload, } from 'lucide-react';
import { ExportSettingsPanel } from './exportDialog/ExportSettingsPanel';
import { ExportPreviewPanel } from './exportDialog/ExportPreviewPanel';
import { AppButton } from './AppButton';

interface ExportDialogProps {
  open: boolean;
  background: string;
  cardTheme: CardTheme;
  palettes: readonly { key: string; from: string; to: string; label: string; card: CardTheme }[];
  selectedPalette: string;
  setSelectedPalette: (value: string) => void;
  direction: string;
  setDirection: (value: string) => void;
  showPrompt: boolean;
  setShowPrompt: (value: boolean) => void;
  showProvider: boolean;
  setShowProvider: (value: boolean) => void;
  showTimestamp: boolean;
  setShowTimestamp: (value: boolean) => void;
  title: string;
  setTitle: (value: string) => void;
  fileName: string;
  setFileName: (value: string) => void;
  format: CaptureFormat;
  setFormat: (value: CaptureFormat) => void;
  preview: MarkdownCapturePayload | null;
  t: (key: string) => string;
  busy: boolean;
  busyMode: 'copy' | 'save' | null;
  onCopy: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  background,
  cardTheme,
  palettes,
  selectedPalette,
  setSelectedPalette,
  direction,
  setDirection,
  showPrompt,
  setShowPrompt,
  showProvider,
  setShowProvider,
  showTimestamp,
  setShowTimestamp,
  title,
  setTitle,
  fileName,
  setFileName,
  format,
  setFormat,
  preview,
  t,
  busy,
  busyMode,
  onCopy,
  onSave,
  onCancel,
}) => {
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
          <Box c="var(--accent)"><Upload size={16} /></Box>
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
          title={title}
          setTitle={setTitle}
          fileName={fileName}
          setFileName={setFileName}
          format={format}
          setFormat={setFormat}
          t={t}
        />

        <ExportPreviewPanel
          background={background}
          cardTheme={cardTheme}
          showPrompt={showPrompt}
          showProvider={showProvider}
          showTimestamp={showTimestamp}
          preview={preview}
          t={t}
        />
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
