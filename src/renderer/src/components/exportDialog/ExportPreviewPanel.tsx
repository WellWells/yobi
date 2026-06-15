import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Box, Group, Stack, Text } from '@mantine/core';
import { Clock3, Cpu } from 'lucide-react';
import type { CardTheme, MarkdownCapturePayload } from '../../../../shared/types';
import { REHYPE_PLUGINS } from '../../utils/shikiPlugins';
import { SharedCodeBlock, SharedPreBlock, remarkPlugins } from '../../utils/markdownConfig';
import { CAPTURE_CARD_TOKENS, captureCardCssVars } from '../../hooks/captureTheme';
import { ForcedCodeThemeContext } from '../../utils/forcedCodeTheme';
import { SectionLabel } from './SectionLabel';
import './exportPreview.css';

export interface ExportPreviewPanelProps {
  background: string;
  cardTheme: CardTheme;
  showPrompt: boolean;
  showProvider: boolean;
  showTimestamp: boolean;
  preview: MarkdownCapturePayload | null;
  t: (key: string) => string;
}

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

export const ExportPreviewPanel: React.FC<ExportPreviewPanelProps> = ({
  background,
  cardTheme,
  showPrompt,
  showProvider,
  showTimestamp,
  preview,
  t,
}) => {
  const tokens = CAPTURE_CARD_TOKENS[cardTheme];
  return (
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
          <ForcedCodeThemeContext.Provider value="dark">
          <Box
            className="export-preview-card"
            p={12}
            style={{ ...captureCardCssVars(cardTheme), background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 10, color: tokens.text, fontSize: 'var(--font-size-sm)', lineHeight: 1.5 } as React.CSSProperties}
          >
            <Text fw={700} mb={6} fz="var(--font-size-base)" style={{ color: tokens.title }}>
              {preview?.title || t('capture.noTitle')}
            </Text>
            {(showProvider || showTimestamp) && (
              <Group gap={8} wrap="wrap" mb={6} fz="var(--font-size-xs)" style={{ color: tokens.muted }}>
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
                p="5px 8px"
                mb={6}
                style={{ background: tokens.promptBg, border: `1px solid ${tokens.promptBorder}`, borderRadius: 6, fontSize: 'var(--font-size-xs)' }}
              >
                <Box className="md-content" style={{ maxHeight: 96, overflowY: 'auto', lineHeight: 1.5, color: tokens.textSecondary }}>
                  <PreviewMarkdown>{preview.prompt}</PreviewMarkdown>
                </Box>
              </Box>
            )}
            <Box className="md-content" style={{ color: tokens.text, fontSize: 'var(--font-size-xs)' }}>
              <PreviewMarkdown>{preview?.content || preview?.summary || ''}</PreviewMarkdown>
            </Box>
          </Box>
          </ForcedCodeThemeContext.Provider>
        </Box>
      </Box>
    </Stack>
  );
};
