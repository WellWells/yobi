import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Modal, Button, Switch, ActionIcon, Box, Flex, Group, Stack, Text } from '@mantine/core';
import 'katex/dist/katex.min.css';
import type { CaptureFormat, MarkdownCapturePayload } from '../../../shared/types';
import {
  Check,
  Clipboard,
  Clock3,
  Cpu,
  Download,
  FileText,
  Image as ImageIcon,
  Save,
  Upload,
  Zap,
} from 'lucide-react';
import { REHYPE_PLUGINS } from '../utils/shikiPlugins';
import { SharedCodeBlock, SharedPreBlock, remarkPlugins } from '../utils/markdownConfig';
import { AppTextInput } from './AppTextInput';

interface ExportDialogProps {
  open: boolean;
  background: string;
  palettes: readonly { key: string; from: string; to: string; label: string }[];
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

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fz="var(--font-size-base)" fw={700} lts="0.05em" tt="uppercase" c="var(--text-muted)" mb={8}>
    {children}
  </Text>
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

const previewMdComponents = { pre: SharedPreBlock, code: SharedCodeBlock } as const;

const PreviewMarkdown: React.FC<{ children: string }> = ({ children }) => (
  <ReactMarkdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={REHYPE_PLUGINS}
    components={previewMdComponents}
  >
    {children}
  </ReactMarkdown>
);

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  background,
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

        {/* Body */}
        <Flex flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          {/* Left column: settings */}
          <Stack
            gap={16}
            p={16}
            w={300}
            style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}
          >

            {/* Format selector */}
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

            {/* Show/hide toggles */}
            <Box>
              <SectionLabel>{t('capture.visible')}</SectionLabel>
              <Stack gap={10}>
                <ToggleChip checked={showPrompt}    onChange={setShowPrompt}    label={t('capture.showPrompt')} />
                <ToggleChip checked={showProvider}  onChange={setShowProvider}  label={t('capture.showProvider')} />
                <ToggleChip checked={showTimestamp} onChange={setShowTimestamp} label={t('capture.showTimestamp')} />
              </Stack>
            </Box>

            {/* Background palette — bicolor half-circle pills */}
            <Box>
              <SectionLabel>{t('common.background')}</SectionLabel>
              <Group gap={6} wrap="wrap">
                {palettes.map((item) => {
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
                      {/* Left half */}
                      <Box
                        component="span"
                        style={{ position: 'absolute', inset: 0, clipPath: 'inset(0 50% 0 0)', background: item.from }}
                      />
                      {/* Right half */}
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

            {/* Gradient direction — 3×3 compass grid */}
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

          {/* Right column: preview */}
          <Stack
            gap={12}
            p={16}
            flex={1}
            bg="var(--bg-tertiary)"
            style={{ minHeight: 0, overflowY: 'auto' }}
          >
            <SectionLabel>{t('capture.preview')}</SectionLabel>
            <Box style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
              <Box p={10} style={{ background }}>
                <Box
                  bg="var(--bg-secondary)"
                  p={12}
                  style={{ border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}
                >
                  <Text fw={700} c="var(--text-primary)" mb={6} fz="var(--font-size-base)">
                    {preview?.title || '(no title)'}
                  </Text>
                  {(showProvider || showTimestamp) && (
                    <Group gap={8} wrap="wrap" mb={6} c="var(--text-muted)" fz="var(--font-size-xs)">
                      {showProvider && preview?.provider && (
                        <Group component="span" gap={4}>
                          <Cpu size={10} />
                          {preview.provider}
                        </Group>
                      )}
                      {showTimestamp && preview?.timestamp && (
                        <Group component="span" gap={4}>
                          <Clock3 size={10} />
                          {preview.timestamp}
                        </Group>
                      )}
                    </Group>
                  )}
                  {showPrompt && preview?.prompt && (
                    <Box
                      bg="var(--bg-tertiary)"
                      p="5px 8px"
                      mb={6}
                      style={{ border: '1px solid var(--border)', borderRadius: 6, fontSize: 'var(--font-size-xs)' }}
                    >
                      <Box className="md-content" style={{ maxHeight: 96, overflowY: 'auto', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                        <PreviewMarkdown>{preview.prompt}</PreviewMarkdown>
                      </Box>
                    </Box>
                  )}
                  <Box className="md-content" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                    <PreviewMarkdown>{preview?.content || preview?.summary || ''}</PreviewMarkdown>
                  </Box>
                </Box>
              </Box>
            </Box>
          </Stack>
        </Flex>

        {/* Footer */}
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
          <Button
            variant="outline"
            onClick={onCopy}
            disabled={busy}
            loading={busyMode === 'copy'}
            justify="center"
            leftSection={busyMode === 'copy' ? undefined : (isPdf ? <Clipboard size={14} /> : <ImageIcon size={14} />)}
          >
            {busyMode === 'copy' ? t('capture.copying') : t('capture.copy')}
          </Button>
          <Button
            variant="filled"
            onClick={onSave}
            disabled={busy}
            loading={busyMode === 'save'}
            justify="center"
            leftSection={busyMode === 'save' ? undefined : (isPdf ? <Save size={14} /> : <Download size={14} />)}
          >
            {busyMode === 'save' ? t('capture.exporting') : saveLabel}
          </Button>
        </Group>
      </Modal>
  );
};

