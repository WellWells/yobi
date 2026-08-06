import React from 'react';
import { Box, Collapse, Group, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import type { CaptureFormat, CaptureRange, CardLayout } from '../../../../shared/types';
import { CAPTURE_WIDTHS, captureWidthLabelKey } from '../../../../shared/types';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { AppTextInput } from '../AppTextInput';
import { BackgroundStylePicker, DirectionGrid, PaletteSwatchGrid } from '../capture/PalettePicker';
import type {
  CaptureBackgroundStyle,
  CaptureDirection,
  CapturePalette,
} from '../../../../shared/capturePalettes';
import { mustShowPrompt } from '../../hooks/captureRequest';
import { SectionLabel } from './SectionLabel';

export interface ExportSettingsPanelProps {
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
  hiDpi: boolean;
  setHiDpi: (value: boolean) => void;
  zip: boolean;
  setZip: (value: boolean) => void;
  onHoverPalette: (key: string | null) => void;
  t: (key: string) => string;
}

const ToggleChip: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}> = ({ checked, onChange, label, description }) => (
  <Switch
    checked={checked}
    onChange={(e) => onChange(e.currentTarget.checked)}
    label={label}
    description={description}
    size="sm"
    withThumbIndicator={false}
  />
);

const FORMAT_OPTIONS: Array<{ value: CaptureFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'pdf', label: 'PDF' },
];

export const ExportSettingsPanel: React.FC<ExportSettingsPanelProps> = ({
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
  hiDpi,
  setHiDpi,
  zip,
  setZip,
  onHoverPalette,
  t,
}) => {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  return (
    <Stack
      gap={16}
      p={16}
      w={300}
      style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}
    >
      <Box>
        <SectionLabel>{t('capture.layout')}</SectionLabel>
        <AppSegmentedControl
          value={cardLayout}
          onChange={(value) => setCardLayout(value as CardLayout)}
          options={[
            { value: 'document', label: t('capture.layout.document') },
            { value: 'bubble', label: t('capture.layout.bubble') },
          ]}
        />
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" mt={6}>
          {t(`capture.layout.${cardLayout}.desc`)}
        </Text>
      </Box>

      {turnCount > 1 && (
        <Box>
          <SectionLabel>{t('capture.range')}</SectionLabel>
          <AppSegmentedControl
            value={range}
            onChange={(value) => setRange(value as CaptureRange)}
            options={[
              { value: 'all', label: t('capture.range.all') },
              { value: 'last', label: t('capture.range.last') },
            ]}
          />
        </Box>
      )}

      <Box>
        <SectionLabel>{t('capture.size')}</SectionLabel>
        <AppSegmentedControl
          value={String(width)}
          onChange={(value) => setWidth(Number(value))}
          options={CAPTURE_WIDTHS.map((value) => ({
            value: String(value),
            label: t(captureWidthLabelKey(value)),
          }))}
        />
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" mt={6}>
          {hiDpi ? `${width} px · 2× → ${width * 2} px` : `${width} px`}
        </Text>
      </Box>

      <Box>
        <SectionLabel>{t('capture.format')}</SectionLabel>
        <AppSegmentedControl
          value={format}
          onChange={(value) => setFormat(value as CaptureFormat)}
          options={FORMAT_OPTIONS}
        />
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" mt={6}>
          {t(`capture.format.${format}.desc`)}
        </Text>
      </Box>

      <Box>
        <SectionLabel>{t('capture.cardTitle')}</SectionLabel>
        <AppTextInput
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          size="sm"
        />
      </Box>

      <Box>
        <SectionLabel>{t('capture.fileName')}</SectionLabel>
        <AppTextInput
          value={fileName}
          onChange={(e) => setFileName(e.currentTarget.value)}
          size="sm"
          rightSection={
            <Text fz="var(--font-size-sm)" c="var(--text-muted)" pr={4}>{`.${zip ? 'zip' : format}`}</Text>
          }
          rightSectionWidth={54}
          rightSectionPointerEvents="none"
        />
      </Box>

      <UnstyledButton onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
        <Group gap={4} align="center">
          <Box
            c="var(--text-muted)"
            style={{
              display: 'flex',
              transform: advancedOpen ? 'rotate(90deg)' : undefined,
              transition: 'transform 0.15s ease',
            }}
          >
            <ChevronRight size={14} />
          </Box>
          <SectionLabel>{t('capture.advanced')}</SectionLabel>
        </Group>
      </UnstyledButton>

      <Collapse expanded={advancedOpen}>
        <Stack gap={16}>
          <Box>
            <SectionLabel>{t('capture.output')}</SectionLabel>
            <Stack gap={10}>
              <ToggleChip
                checked={hiDpi}
                onChange={setHiDpi}
                label={t('capture.hiDpi')}
                description={t('capture.hiDpi.desc')}
              />
              <ToggleChip
                checked={zip}
                onChange={setZip}
                label={t('capture.zip')}
                description={t('capture.zip.desc')}
              />
            </Stack>
          </Box>

          <Box>
            <SectionLabel>{t('capture.visible')}</SectionLabel>
            <Stack gap={10}>
              {
}
              {!mustShowPrompt(cardLayout, range === 'last' ? 1 : turnCount) && (
                <ToggleChip checked={showPrompt} onChange={setShowPrompt} label={t('capture.showPrompt')} />
              )}
              <ToggleChip checked={showProvider} onChange={setShowProvider} label={t('capture.showProvider')} />
              <ToggleChip checked={showTimestamp} onChange={setShowTimestamp} label={t('capture.showTimestamp')} />
              <ToggleChip checked={showTokens} onChange={setShowTokens} label={t('capture.showTokens')} />
            </Stack>
          </Box>

          <Box>
            <SectionLabel>{t('common.background')}</SectionLabel>
            <Stack gap={10}>
              <BackgroundStylePicker value={backgroundStyle} onChange={setBackgroundStyle} t={t} />
              <PaletteSwatchGrid
                palettes={palettes}
                value={selectedPalette}
                onChange={setSelectedPalette}
                style={backgroundStyle}
                direction={direction as CaptureDirection}
                onHover={onHoverPalette}
                t={t}
              />
            </Stack>
          </Box>

          {
}
          {backgroundStyle === 'gradient' && (
            <Box>
              <SectionLabel>{t('capture.direction')}</SectionLabel>
              <DirectionGrid value={direction} onChange={setDirection} />
            </Box>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
};
