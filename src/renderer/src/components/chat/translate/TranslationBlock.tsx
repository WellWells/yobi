import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Loader, Text, Tooltip } from '@mantine/core';
import { Check, Copy, Languages, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react';
import type { TurnTranslation } from '../../../../../shared/conversationDoc';
import { isTranslateLanguage, languageDisplayName } from '../../../../../shared/translateLanguages';
import { clipboardApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import { turnKey, useTranslateStore, type TranslationView, type TurnTranslateJob } from '../../../store/translateStore';
import { READING_TEXT_STYLE } from '../../../styles/readingText';
import { AppButton } from '../../AppButton';
import { AppSegmentedControl } from '../../AppSegmentedControl';
import { MessageMarkdown } from '../MessageMarkdown';
import {
  cancelTurnTranslation, convertTurnToTraditional, removeTurnTranslation, translateTurn,
} from './translateActions';
import { useProviderLabel } from './useTurnTranslation';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface TranslationBlockProps {
  path: string;
  turnIndex: number;
  response: string;
  translation: TurnTranslation | null;
  outdated: boolean;
  job: TurnTranslateJob | undefined;
  view: TranslationView;
  t: (key: string) => string;
}

const VIEWS: TranslationView[] = ['original', 'translation', 'both'];

const FRAME_STYLE = {
  border: '1px solid var(--border)',
  borderLeft: '3px solid var(--accent)',
  borderRadius: 'var(--mantine-radius-md)',
  background: 'var(--bg-secondary)',
} as const;

/**
 * An answer's translation, under the answer and outside it: not part of the answer's text (the
 * selection tools leave it alone) and labelled with who made it, so it never reads as the original
 * reply. Ctrl+F searches the translated text itself — with "translation only" it is all there is to
 * read — but not the header's labels and buttons.
 */
export const TranslationBlock: React.FC<TranslationBlockProps> = ({
  path, turnIndex, response, translation, outdated, job, view, t,
}) => {
  const locale = useI18nStore((s) => s.locale);
  const setView = useTranslateStore((s) => s.setView);
  const providerLabel = useProviderLabel();
  const [copied, setCopied] = useState(false);
  const key = turnKey(path, turnIndex);

  if (job && job.status !== 'error') {
    return (
      <Group data-selection-ignore data-find-omit mt={10} px={12} py={8} gap={8} wrap="nowrap" style={FRAME_STYLE}>
        <Loader size={14} />
        <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)" style={{ flex: 1 }}>
          {t(job.by === 'opencc' ? 'chat.translate.converting' : `chat.translate.${job.status}`)}
        </Text>
        <AppButton size="compact-sm" variant="default" onClick={() => cancelTurnTranslation(path, turnIndex)}>
          {t('chat.rewrite.cancel')}
        </AppButton>
      </Group>
    );
  }

  if (job?.status === 'error') {
    return (
      <Group data-selection-ignore data-find-omit mt={10} px={12} py={8} gap={8} wrap="nowrap" align="flex-start" style={FRAME_STYLE}>
        <Box c="var(--mantine-color-error)" style={{ lineHeight: 0, paddingTop: 2 }}><TriangleAlert size={14} /></Box>
        <Text component="div" fz="var(--font-size-sm)" c="var(--mantine-color-error)" style={{ flex: 1 }}>{job.error}</Text>
        <AppButton
          size="compact-sm"
          variant="default"
          onClick={() => {
            if (job.by === 'opencc') void convertTurnToTraditional({ path, turnIndex, response });
            else void translateTurn({ path, turnIndex, response, to: job.to, providerLabel });
          }}
        >
          {t('chat.rewrite.retry')}
        </AppButton>
        <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.translate.dismiss')} onClick={() => cancelTurnTranslation(path, turnIndex)}>
          <X size={12} />
        </ActionIcon>
      </Group>
    );
  }

  if (!translation) return null;

  const language = isTranslateLanguage(translation.to) ? languageDisplayName(translation.to, locale) : translation.to;
  const source = translation.by === 'opencc'
    ? t('chat.translate.byLocal')
    : fillTemplate(t('chat.translate.byProvider'), { provider: translation.p ?? '' });

  const copy = (): void => {
    void clipboardApi.copyText(translation.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  };

  const retranslate = (): void => {
    if (translation.by === 'opencc') void convertTurnToTraditional({ path, turnIndex, response });
    else if (isTranslateLanguage(translation.to)) void translateTurn({ path, turnIndex, response, to: translation.to, providerLabel });
  };

  return (
    <Box data-selection-ignore mt={10} style={FRAME_STYLE}>
      <Group data-find-omit justify="space-between" wrap="wrap" gap={8} px={12} pt={8} pb={view === 'original' ? 8 : 0}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Languages size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <Text component="div" fz="var(--font-size-sm)" fw={600} c="var(--text-secondary)" truncate>
            {fillTemplate(t('chat.translate.title'), { language })}
          </Text>
          <Tooltip
            label={translation.by === 'opencc' ? t('chat.translate.byLocal.hint') : t('chat.translate.providerHint')}
            position="bottom"
            multiline
            maw={280}
          >
            <Text component="div" fz="var(--font-size-xs)" c="var(--text-muted)" style={{ flexShrink: 0 }}>{source}</Text>
          </Tooltip>
          {outdated && <Badge variant="light" size="sm">{t('chat.translate.outdated')}</Badge>}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Box w={210}>
            <AppSegmentedControl
              size="xs"
              value={view}
              onChange={(value) => { if ((VIEWS as string[]).includes(value)) setView(key, value as TranslationView); }}
              options={VIEWS.map((value) => ({ value, label: t(`chat.translate.view.${value}`) }))}
            />
          </Box>
          <Tooltip label={copied ? t('chat.copied') : t('chat.translate.copy')} position="bottom">
            <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.translate.copy')} onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('chat.translate.again')} position="bottom">
            <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.translate.again')} onClick={retranslate}>
              <RefreshCw size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('chat.translate.remove')} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t('chat.translate.remove')}
              onClick={() => { void removeTurnTranslation(path, turnIndex, response); }}
            >
              <Trash2 size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {translation.unmatched && view !== 'original' && (
        <Group data-find-omit gap={6} px={12} pt={6} wrap="nowrap" align="flex-start">
          <Box c="var(--mantine-color-warning)" style={{ lineHeight: 0, paddingTop: 2 }}><TriangleAlert size={13} /></Box>
          <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)">{t('chat.translate.unmatched')}</Text>
        </Group>
      )}

      {view !== 'original' && (
        <Box
          className="md-content"
          data-find-scope
          px={12}
          pt={6}
          pb={10}
          style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}
        >
          <MessageMarkdown>{translation.text}</MessageMarkdown>
        </Box>
      )}
    </Box>
  );
};
