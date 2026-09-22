import React, { useMemo, useState } from 'react';
import { Modal, Button, Box, Flex, Group, Text, Tooltip } from '@mantine/core';
import type { MarkdownCaptureRequest } from '../../../shared/types';
import { Clipboard, Download, Image as ImageIcon, ImageDown, Save } from 'lucide-react';
import { ExportSettingsPanel } from './exportDialog/ExportSettingsPanel';
import type { ExportSettingsPanelProps } from './exportDialog/ExportSettingsPanel';
import { ExportPreviewPanel } from './exportDialog/ExportPreviewPanel';
import { AppButton } from './AppButton';
import { captureBackgroundCss, paletteCardTheme } from '../../../shared/capturePalettes';
import type { CaptureDirection } from '../../../shared/capturePalettes';

/**
 * Every capture setting belongs to the panel; the dialog only adds the shell around it. Restating
 * the 30 names here is how the two lists drift apart, so they are one list plus the shell's own.
 * `onHoverPalette` is the dialog's, not the caller's: hovering drives its live preview.
 */
interface ExportDialogProps extends Omit<ExportSettingsPanelProps, 'onHoverPalette'> {
  open: boolean;
  request: MarkdownCaptureRequest | null;
  busy: boolean;
  busyMode: 'copy' | 'save' | null;
  onCopy: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  request,
  busy,
  busyMode,
  onCopy,
  onSave,
  onCancel,
  ...settings
}) => {
  const { palettes, backgroundStyle, direction, format, t } = settings;
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
        <ExportSettingsPanel {...settings} onHoverPalette={setHoveredPalette} />

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
