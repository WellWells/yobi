import React from 'react';
import { ActionIcon, Box, Button, Flex, Group, Stack, Switch, Text } from '@mantine/core';
import { Check, FileText, Image as ImageIcon, Zap } from 'lucide-react';
import type { CaptureFormat, CardTheme } from '../../../../shared/types';
import { AppTextInput } from '../AppTextInput';
import { SectionLabel } from './SectionLabel';

export interface ExportSettingsPanelProps {
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
  t: (key: string) => string;
}

const ToggleChip: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <Switch
    checked={checked}
    onChange={(e) => onChange(e.currentTarget.checked)}
    label={label}
    size="sm"
    withThumbIndicator={false}
  />
);

const formatChoices: Array<{ key: CaptureFormat; label: string; icon: React.ReactNode; descKey: string }> = [
  { key: 'png', label: 'PNG', icon: <ImageIcon size={14} />, descKey: 'capture.format.png.desc' },
  { key: 'webp', label: 'WEBP', icon: <Zap size={14} />, descKey: 'capture.format.webp.desc' },
  { key: 'pdf', label: 'PDF', icon: <FileText size={14} />, descKey: 'capture.format.pdf.desc' },
];

const directionButtons: Array<[string, string]> = [
  ['nw', '↖'], ['n', '↑'], ['ne', '↗'],
  ['w', '←'], ['c', '●'], ['e', '→'],
  ['sw', '↙'], ['s', '↓'], ['se', '↘'],
];

export const ExportSettingsPanel: React.FC<ExportSettingsPanelProps> = ({
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
  t,
}) => (
  <Stack
    gap={16}
    p={16}
    w={300}
    style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}
  >

    <Box>
      <SectionLabel>{t('capture.format')}</SectionLabel>
      <Stack gap={6}>
        {formatChoices.map((item) => {
          const active = format === item.key;
          return (
            <Button
              key={item.key}
              onClick={() => setFormat(item.key)}
              variant={active ? 'light' : 'default'}
              fullWidth
              justify="flex-start"
              radius="sm"
              h="auto"
              py={8}
              px={12}
              leftSection={
                <Box component="span" c={active ? 'var(--accent)' : 'var(--text-secondary)'} style={{ display: 'inline-flex' }}>
                  {item.icon}
                </Box>
              }
              styles={{
                label: { flex: 1, display: 'flex', alignItems: 'center', gap: 8, width: '100%' },
                inner: { width: '100%' },
              }}
            >
              <Text component="span" fz="var(--font-size-md)" fw={700} ta="left" c={active ? 'var(--accent)' : 'var(--text-primary)'} flex={1}>
                {item.label}
              </Text>
              <Text component="span" fz="var(--font-size-sm)" c="var(--text-muted)">
                {t(item.descKey)}
              </Text>
            </Button>
          );
        })}
      </Stack>
    </Box>

    <Box>
      <SectionLabel>{t('agentflow.skill.utility.export.title')}</SectionLabel>
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
      />
    </Box>

    <Box>
      <SectionLabel>{t('capture.visible')}</SectionLabel>
      <Stack gap={10}>
        <ToggleChip checked={showPrompt}    onChange={setShowPrompt}    label={t('capture.showPrompt')} />
        <ToggleChip checked={showProvider}  onChange={setShowProvider}  label={t('capture.showProvider')} />
        <ToggleChip checked={showTimestamp} onChange={setShowTimestamp} label={t('capture.showTimestamp')} />
      </Stack>
    </Box>

    <Box>
      <SectionLabel>{t('common.background')}</SectionLabel>
      <Stack gap={12}>
        {(['dark', 'light'] as const).map((group) => {
          const items = palettes.filter((p) => p.card === group);
          if (items.length === 0) return null;
          return (
            <Box key={group}>
              <Text
                fz="var(--font-size-xs)"
                fw={600}
                c="var(--text-muted)"
                mb={6}
                tt="uppercase"
                style={{ letterSpacing: '0.04em' }}
              >
                {t(`capture.palette.${group}`)}
              </Text>
              <Group gap={6} wrap="wrap">
                {items.map((item) => {
                  const active = selectedPalette === item.key;
                  return (
                    <ActionIcon
                      key={item.key}
                      onClick={() => setSelectedPalette(item.key)}
                      title={item.label}
                      aria-label={item.label}
                      variant="transparent"
                      radius="xl"
                      size={32}
                      style={{
                        position: 'relative',
                        padding: 0,
                        border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
                        overflow: 'hidden',
                        boxShadow: active ? '0 0 0 3px var(--accent-dim)' : 'none',
                        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                        flexShrink: 0,
                      }}
                    >
                      <Box
                        component="span"
                        style={{ position: 'absolute', inset: 0, clipPath: 'inset(0 50% 0 0)', background: item.from }}
                      />
                      <Box
                        component="span"
                        style={{ position: 'absolute', inset: 0, clipPath: 'inset(0 0 0 50%)', background: item.to }}
                      />
                      {active && (
                        <Flex
                          pos="absolute"
                          align="center"
                          justify="center"
                          c="#fff"
                          style={{ inset: 0, textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
                        >
                          <Check size={12} strokeWidth={3} />
                        </Flex>
                      )}
                    </ActionIcon>
                  );
                })}
              </Group>
            </Box>
          );
        })}
      </Stack>
    </Box>

    <Box>
      <SectionLabel>{t('capture.direction')}</SectionLabel>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gap: 4 }}>
        {directionButtons.map(([key, icon]) => (
          <ActionIcon
            key={key}
            onClick={() => setDirection(key)}
            variant={direction === key ? 'light' : 'default'}
            radius="sm"
            size={32}
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 700,
              color: direction === key ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {icon}
          </ActionIcon>
        ))}
      </Box>
    </Box>
  </Stack>
);
