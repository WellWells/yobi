import React, { useState } from 'react';
import { Box, Group, Loader, Menu, ScrollArea, Text, Tooltip } from '@mantine/core';
import { Check, ChevronDown, Copy, Quote, TriangleAlert } from 'lucide-react';
import { languageDisplayName, type TranslateLanguage } from '../../../../../shared/translateLanguages';
import { clipboardApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import { READING_TEXT_STYLE } from '../../../styles/readingText';
import { AppButton } from '../../AppButton';
import { MessageMarkdown } from '../MessageMarkdown';
import { LanguageMenuItems } from './LanguageMenuItems';
import type { SelectionTranslation } from './useSelectionTranslate';
import { useProviderLabel } from './useTurnTranslation';

/** Tall enough for a few lines of result; the selection bar uses it to choose above or below. */
export const SELECTION_TRANSLATE_HEIGHT = 460;

interface SelectionTranslatePanelProps {
  state: SelectionTranslation;
  onRetarget: (to: TranslateLanguage) => void;
  /** Absent where there is no composer to quote into (a Notion document). */
  onQuote?: (text: string) => void;
  t: (key: string) => string;
}

/** The selection bar's unfolded area for a translation: the result, copy, and quote into the composer. */
export const SelectionTranslatePanel: React.FC<SelectionTranslatePanelProps> = ({ state, onRetarget, onQuote, t }) => {
  const locale = useI18nStore((s) => s.locale);
  const providerLabel = useProviderLabel();
  const [copied, setCopied] = useState(false);
  const busy = state.status !== 'done' && state.status !== 'error';

  return (
    // As wide as the bar allows up to 560px; the result takes whatever height the bar was given.
    <Box w={560} maw="100%" px={12} py={10} style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: '1 1 auto' }}>
      <Group justify="space-between" wrap="nowrap" gap={8}>
        <Menu position="bottom-start" withinPortal shadow="md" withInitialFocusPlaceholder={false}>
          <Menu.Target>
            <AppButton variant="subtle" size="compact-sm" c="var(--text-primary)" rightSection={<ChevronDown size={12} />}>
              {t('chat.translate.into').replace('{{language}}', languageDisplayName(state.to, locale))}
            </AppButton>
          </Menu.Target>
          <Menu.Dropdown miw={200}>
            <LanguageMenuItems defaultTag={state.to} onPick={onRetarget} t={t} />
          </Menu.Dropdown>
        </Menu>
        {state.providerUrl && (
          <Tooltip label={t('chat.translate.providerHint')} position="bottom" multiline maw={280}>
            <Text component="div" fz="var(--font-size-xs)" c="var(--text-muted)" style={{ flexShrink: 0 }}>
              {providerLabel(state.providerUrl)}
            </Text>
          </Tooltip>
        )}
      </Group>

      {busy && (
        <Group gap={8} wrap="nowrap">
          <Loader size={14} />
          <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)">{t(`chat.translate.${state.status}`)}</Text>
        </Group>
      )}

      {state.status === 'error' && (
        <Group gap={8} wrap="nowrap" align="flex-start">
          <Box c="var(--mantine-color-error)" style={{ lineHeight: 0, paddingTop: 2 }}><TriangleAlert size={14} /></Box>
          <Text component="div" fz="var(--font-size-sm)" c="var(--mantine-color-error)">{state.error}</Text>
        </Group>
      )}

      {state.status === 'done' && (
        <>
          {state.unmatched && (
            <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)">{t('chat.translate.unmatched')}</Text>
          )}
          <ScrollArea.Autosize mah={360} type="auto" style={{ flex: '1 1 auto', minHeight: 0 }}>
            <Box className="md-content" style={{ ...READING_TEXT_STYLE, lineHeight: 1.7, color: 'var(--text-primary)' }}>
              <MessageMarkdown>{state.result}</MessageMarkdown>
            </Box>
          </ScrollArea.Autosize>
          <Group gap={6}>
            <AppButton
              size="compact-sm"
              variant="default"
              leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={() => {
                void clipboardApi.copyText(state.result).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_600);
                });
              }}
            >
              {copied ? t('chat.copied') : t('chat.rewrite.copy')}
            </AppButton>
            {onQuote && (
              <AppButton size="compact-sm" variant="subtle" leftSection={<Quote size={14} />} onClick={() => onQuote(state.result)}>
                {t('chat.rewrite.quote')}
              </AppButton>
            )}
          </Group>
        </>
      )}
    </Box>
  );
};
